module Admin
  # 上流 FHIR サーバーへの接続設定(SMART Backend Services / client_credentials)を
  # 画面から編集する。client_secret はブラウザへ返さず(書込専用)、DB では暗号化して保持する。
  class FhirConnectionSettingsController < BaseController
    before_action :set_settings, only: %i[show update]

    def show
      render json: masked(@settings)
    end

    def update
      attrs = settings_params
      # 秘密の類は入力があったときだけ更新する(空なら既存の暗号化値を保持)。
      attrs = attrs.except(:client_secret) if attrs[:client_secret].blank?
      attrs = attrs.except(:fhir_admin_token) if attrs[:fhir_admin_token].blank?

      if @settings.update(attrs)
        # このプロセスのシングルトンを即時に作り直させる。他プロセスは次リクエスト時に
        # config_version の変化で遅延リビルドする。
        FhirTokenProvider.reset_default!
        render json: masked(@settings)
      else
        render json: { errors: @settings.errors.full_messages }, status: :unprocessable_content
      end
    end

    # 保存済みの実効設定で上流への接続を試す。token/secret は一切返さない。
    # 認証あり(client_credentials)ならトークン取得を、no-auth なら /metadata 到達を確認する。
    # 注意: Render のコールドスタート時は warm_up! が最大 ~90 秒ブロックし得る。
    def test
      config = FhirConnectionSettings.effective
      provider = FhirTokenProvider.new(
        base_url: config.base_url,
        client_id: config.client_id,
        client_secret: config.client_secret,
        token_path: config.token_path,
        host_header: config.host_header
      )

      if provider.enabled?
        provider.access_token # 失敗時は TokenError を送出
        render json: { ok: true, auth: "backend_services" }
      else
        gateway = FhirGateway.new(
          base_url: config.base_url, host_header: config.host_header, token_provider: provider
        )
        res = gateway.forward(method: :get, path: "/metadata")
        if res.status.between?(200, 299)
          render json: { ok: true, auth: "none" }
        else
          render json: { ok: false, error: "上流が HTTP #{res.status} を返しました" }
        end
      end
    rescue FhirTokenProvider::TokenError
      render json: { ok: false, error: "トークン取得に失敗しました（認証情報または接続先を確認してください）" }
    rescue Faraday::ConnectionFailed, Faraday::TimeoutError => e
      render json: { ok: false, error: "上流に接続できませんでした (#{e.class})" }
    end

    private

    def set_settings
      @settings = FhirConnectionSettings.current
    end

    def settings_params
      # master コントローラと同様にフラットな params を許可する(パラメータラップに依存しない)。
      params.permit(:base_url, :client_id, :client_secret, :token_path, :host_header, :fhir_admin_token)
    end

    # ブラウザ向けの表現。client_secret / fhir_admin_token の値は決して含めない。
    def masked(settings)
      effective = FhirConnectionSettings.effective
      {
        base_url: settings.base_url,
        client_id: settings.client_id,
        token_path: settings.token_path,
        host_header: settings.host_header,
        client_secret_set: settings.client_secret.present?,
        fhir_admin_token_set: settings.fhir_admin_token.present?,
        # 管理API(OAuthクライアント管理画面)が使える状態か。env フォールバック込み。
        admin_api_available: effective.admin_token.present?,
        # env フォールバック込みで、実際に認証(Bearer)が有効になるか。
        auth_enabled: effective.client_id.present? && effective.client_secret.present?,
        # env にフォールバック中かどうかを UI で示すための参考情報(secret は含めない)。
        effective_base_url: effective.base_url,
        effective_auth_source: auth_source(settings, effective)
      }
    end

    def auth_source(settings, effective)
      return "db" if settings.client_id.present? || settings.client_secret.present?
      return "env" if effective.client_id.present? && effective.client_secret.present?

      "none"
    end
  end
end
