module Admin
  # 外部システム連携の設定。どんな設定項目を持つかは定義とアダプタが宣言する。
  #
  # パスワードは FhirConnectionSettings と同じく、ブラウザへ返さず(書込専用)
  # DB では暗号化して保持する。
  class ExternalSystemsController < BaseController
    before_action :set_definition, except: :index
    before_action :set_connection, except: :index

    def index
      render json: { items: Integrations::ExternalSystems.all.map { |definition| summary(definition) } }
    end

    def show
      render json: detail
    end

    def update
      attrs = connection_params
      # 空なら既存の暗号化値を保持する(画面には値を出していないので、
      # 空欄での保存は「変更しない」を意味する)。
      attrs = attrs.except(:password) if attrs[:password].blank?
      attrs[:options] = options_params if params.key?(:options)

      if @connection.update(attrs)
        ExternalSystemConnection.reset_cache!
        render json: detail
      else
        render json: { errors: @connection.errors.full_messages }, status: :unprocessable_content
      end
    end

    # 保存済みの設定で外部システムを 1 回叩く。医療機関名まで見せて、
    # 向き先を間違えたまま運用に入らないようにする。
    def test
      return render json: { ok: false, error: "このシステムは接続テストを持ちません" } unless @definition.section?(:connection)

      config = ExternalSystemConnection.effective(system_key)
      unless config.usable?
        return render json: { ok: false, error: "連携を有効にして、接続先・ユーザー・パスワードを設定してください" }
      end

      adapter = @definition.adapter_class(config.system_type)
      return render json: { ok: false, error: "対応していない製品です: #{config.system_type}" } if adapter.nil?

      render json: adapter.new(config).test_connection
    rescue Integrations::NotConfigured, Integrations::Rejected => e
      render json: { ok: false, error: e.message }
    rescue Faraday::ConnectionFailed, Faraday::TimeoutError => e
      render json: { ok: false, error: "外部システムに接続できませんでした (#{e.class})" }
    end

    # 受信エンドポイントのトークン。院内エージェントに配るので平文で返す。
    def regenerate_inbound_token
      unless @definition.section?(:inbound_token)
        return render json: { error: "not_supported" }, status: :unprocessable_content
      end

      render json: { inbound_token: @connection.regenerate_inbound_token! }
    end

    private

    def system_key = params[:key].to_s

    def set_definition
      @definition = Integrations::ExternalSystems.find!(system_key)
    end

    def set_connection
      @connection = ExternalSystemConnection.current(system_key)
    end

    def connection_params
      params.permit(:enabled, :system_type, :base_url, :username, :password)
    end

    def options_params
      params.require(:options).permit!.to_h
    end

    def summary(definition)
      row = ExternalSystemConnection.current(definition.key)
      definition.as_json.merge(
        enabled: row.enabled,
        system_type: row.system_type,
        usable: ExternalSystemConnection.effective(definition.key).usable?
      )
    end

    def detail
      effective = ExternalSystemConnection.effective(system_key)

      @definition.as_json.merge(
        enabled: @connection.enabled,
        system_type: @connection.system_type,
        base_url: @connection.base_url,
        username: @connection.username,
        options: @connection.options,
        password_set: @connection.password.present?,
        inbound_token_set: @connection.inbound_token.present?,
        # env フォールバック込みで、実際に使える状態か。
        usable: effective.usable?,
        effective_base_url: effective.base_url,
        option_fields: @definition.option_fields(@connection.system_type),
        code_kinds: @definition.code_kinds(@connection.system_type)
      )
    end
  end
end
