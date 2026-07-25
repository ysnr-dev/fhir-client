require "faraday"

# 上流 FHIR サーバー(Render 無料枠)のコールドスタート待ち。
#
# 無料枠は ~15 分アイドルでスピンダウンし、最初のリクエストで起動に ~50 秒
# (それ以上のことも)かかる。その間ゲートウェイはリクエストを保留するか
# 502/503/504 を返す。認証されていない /up が 2xx を返すまでポーリングして
# 「本当に起きた」ことを確認してから本題のリクエストを投げる。
#
# FhirTokenProvider(トークン取得の前に常に待つ)と FhirAdminGateway(まず投げて、
# transient 失敗のときだけ待つ)で共有する。ベストエフォートで例外は投げない
# -- 起きてこなければ呼び出し側のリクエストが失敗として現れる。
module UpstreamWarmup
  # コールドな Render は起動完了まで /up を保留し得るので、1 回のプローブに
  # 起動時間まるごとを与える。
  PROBE_TIMEOUT = 90
  # ゲートウェイが /up を保留せず 502/503 で即座に落とす場合のための上限
  # (この間隔で ~60 秒)。
  MAX_ATTEMPTS = 20
  POLL_INTERVAL = 3

  module_function

  def wait_until_ready(base_url:, host_header: nil, sleeper: ->(seconds) { sleep(seconds) })
    connection = probe_connection(base_url, host_header)

    MAX_ATTEMPTS.times do |attempt|
      return true if ready?(connection)

      sleeper.call(POLL_INTERVAL) unless attempt == MAX_ATTEMPTS - 1
    end
    false
  end

  def ready?(connection)
    connection.get.success?
  rescue StandardError
    false
  end

  def probe_connection(base_url, host_header)
    Faraday.new(url: "#{base_url.to_s.chomp('/')}/up") do |f|
      f.options.open_timeout = 2
      f.options.timeout = PROBE_TIMEOUT
      f.headers["Host"] = host_header if host_header.present?
      f.adapter Faraday.default_adapter
    end
  end
end
