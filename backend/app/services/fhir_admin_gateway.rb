require "faraday"

# 上流 FHIR サーバーの管理API(/admin/oauth_clients、/admin/scopes)への
# サーバー間クライアント。
#
# FhirGateway とは別クラスにしている。FhirGateway は FhirTokenProvider の
# OAuth Bearer を無条件に付け、401 を受けるとトークンを invalidate して 1 回
# リトライする。管理APIではどちらも誤りで:
#
#   * 資格情報が別物(FHIR_ADMIN_TOKEN)であり、OAuth トークンは一切使わない
#   * ここでの 401 は「管理トークンが違う」を意味する。リトライしても直らないし、
#     上流のレート制限(admin/ip)を余計に消費するだけ
#
# なので Authorization ヘッダーは付けず、401 では絶対にリトライしない。
class FhirAdminGateway
  # 管理トークンが未設定。UI に「設定してください」と出すために区別する。
  class NotConfigured < StandardError; end

  # Render のエッジがコールドスタート中に返すステータス。
  TRANSIENT_STATUSES = [502, 503, 504].freeze
  # 上流アプリ自身の「管理APIが無効(FHIR_ADMIN_TOKEN 未設定)」も 503 で返るが、
  # これは設定を直すまで永続する状態で、待って再送しても絶対に変わらない。
  # エッジ由来の 503 と区別しないと、設定漏れのたびに最大60秒待たされる。
  DISABLED_MARKER = "admin_api_disabled".freeze

  def initialize(config: FhirConnectionSettings.effective, warmup: UpstreamWarmup)
    @base_url = config.base_url
    @host_header = config.host_header
    @admin_token = config.admin_token
    @warmup = warmup
    @warmed_up = false
  end

  def configured?
    @admin_token.present?
  end

  def request(method, path, body: nil)
    raise NotConfigured unless configured?

    response =
      begin
        send_request(method, path, body)
      rescue Faraday::TimeoutError, Faraday::ConnectionFailed
        # コールドスタート中は接続自体が失敗し得る。1 度だけ起きるのを待って再試行。
        raise unless warm_up_once

        send_request(method, path, body)
      end
    return response unless transient?(response) && warm_up_once

    send_request(method, path, body)
  end

  private

  attr_reader :base_url, :host_header, :admin_token

  def transient?(response)
    return false unless TRANSIENT_STATUSES.include?(response.status)

    !response.body.to_s.include?(DISABLED_MARKER)
  end

  # ウォームアップは「失敗してから」1 度だけ。FhirTokenProvider のように無条件に
  # 待つと、クライアント一覧を開くたびに最大 90 秒ブロックしてしまう。
  def warm_up_once
    return false if @warmed_up

    @warmed_up = true
    @warmup.wait_until_ready(base_url: base_url, host_header: host_header)
    true
  end

  def send_request(method, path, body)
    connection.run_request(method, path, body, request_headers)
  end

  def request_headers
    headers = {
      "X-FHIR-Admin-Token" => admin_token,
      "Content-Type" => "application/json",
      "Accept" => "application/json"
    }
    # 上流の HostAuthorization は host.docker.internal のようなホスト名を拒否する。
    headers["Host"] = host_header if host_header.present?
    headers
  end

  def connection
    @connection ||= Faraday.new(url: base_url) do |f|
      f.options.open_timeout = 2
      f.options.timeout = 15
      f.adapter Faraday.default_adapter
    end
  end
end
