# 上流 FHIR サーバーの管理API への中継の共通部分。
#
# ステータスの読み替えがこの concern の本体。とくに **上流の 401/403 を
# そのまま返してはいけない**: SPA は 401 を「このアプリのセッションが切れた」と
# 解釈してログイン画面に戻すので、実際には「サーバー側の管理トークン設定ミス」
# であるものがログアウトとして現れてしまう。502 に読み替えて、原因を日本語で示す。
module UpstreamAdminRelay
  extend ActiveSupport::Concern

  # 上流のボディをそのまま透過させるステータス。上流はこちらと同じ JSON 規約
  # ({errors: [...]} / {error:, error_description:}) で返すので、SPA の
  # buildError() がそのまま描画できる。
  PASS_THROUGH_STATUSES = [400, 404, 422].freeze

  private

  def relay(method, path, body: nil)
    response = admin_gateway.request(method, path, body: body)

    if response.status.between?(200, 299) || PASS_THROUGH_STATUSES.include?(response.status)
      return render_upstream(response)
    end

    case response.status
    when 401, 403
      render_upstream_error(
        :bad_gateway,
        "FHIR サーバーが管理トークンを拒否しました。接続設定の FHIR 管理トークンを確認してください。"
      )
    when 503
      # 上流の admin_api_disabled = FHIR_ADMIN_TOKEN 未設定
      render_upstream_error(
        :bad_gateway,
        "FHIR サーバー側で管理APIが無効です (FHIR_ADMIN_TOKEN が未設定)"
      )
    when 429
      # 上流のボディは FHIR の OperationOutcome で、SPA は描画できない
      render_upstream_error(:too_many_requests, "FHIR サーバーのレート制限に達しました。少し待って再試行してください。")
    else
      render_upstream_error(:bad_gateway, "FHIR サーバーがエラーを返しました (HTTP #{response.status})")
    end
  rescue FhirAdminGateway::NotConfigured
    render_upstream_error(
      :service_unavailable,
      "接続設定で FHIR 管理トークンを設定してください（上流の FHIR_ADMIN_TOKEN と同じ値）"
    )
  rescue Faraday::ConnectionFailed, Faraday::TimeoutError => e
    render_upstream_error(:bad_gateway, "FHIR サーバーに接続できませんでした (#{e.class})")
  end

  def admin_gateway
    @admin_gateway ||= FhirAdminGateway.new
  end

  def render_upstream(response)
    body = response.body.to_s
    return head(response.status) if body.blank?

    render json: body, status: response.status
  end

  def render_upstream_error(status, message)
    render json: { error: message }, status: status
  end
end
