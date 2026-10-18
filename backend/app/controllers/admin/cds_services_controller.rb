module Admin
  # CDS Hooks のサービス提供元の登録・編集・削除と、discovery の確認(docs/cds-hooks-design.md §2.2)。
  #
  # 提供元には患者情報(prefetch)を送るので、宛先の差し替えは SMART アプリと同じく
  # 本番で ADMIN_TOKEN が無いまま開けてはいけない。
  class CdsServicesController < BaseController
    before_action :require_admin_auth_configured!
    before_action :set_service, only: %i[update destroy discover]

    def index
      services = CdsService.ordered
      render json: { total: services.size, items: services.map { |service| summary(service) } }
    end

    def create
      service = CdsService.new(service_params)
      service.position = next_position if params[:position].blank?
      if service.save
        Integrations::Cds::Discovery.reset!
        render json: summary(service), status: :created
      else
        render json: { errors: service.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      attrs = service_params
      # 認証トークンは入力があったときだけ更新する(空なら既存の暗号化値を保持)。
      attrs = attrs.except(:auth_token) if attrs[:auth_token].blank?
      if @service.update(attrs)
        Integrations::Cds::Discovery.reset!
        render json: summary(@service)
      else
        render json: { errors: @service.errors.full_messages }, status: :unprocessable_content
      end
    end

    def destroy
      @service.destroy!
      Integrations::Cds::Discovery.reset!
      head :no_content
    end

    # GET /admin/cds_services/:id/discover -- その場で discovery を読む(キャッシュは使わない)。
    def discover
      services = Integrations::Cds::Discovery.services(@service, fresh: true)
      render json: {
        services: services.map do |service|
          {
            id: service["id"],
            hook: service["hook"],
            title: service["title"],
            description: service["description"],
            prefetch: service["prefetch"].is_a?(Hash) ? service["prefetch"].keys : []
          }
        end
      }
    rescue Integrations::Error => e
      render json: { error: e.message }, status: :bad_gateway
    end

    private

    def set_service
      @service = CdsService.find(params[:id])
    end

    def service_params
      params.permit(:name, :base_url, :auth_token, :client_id, :enabled, :position)
    end

    def next_position
      (CdsService.maximum(:position) || 0) + 1
    end

    def require_admin_auth_configured!
      return unless Rails.env.production?
      return if ENV["ADMIN_TOKEN"].present?

      render json: { error: "ADMIN_TOKEN が未設定のため、この操作は本番環境で無効です" },
             status: :service_unavailable
    end

    def summary(service)
      {
        id: service.id,
        name: service.name,
        base_url: service.base_url,
        auth_token_set: service.auth_token.present?,
        client_id: service.client_id.presence,
        enabled: service.enabled,
        position: service.position,
        updated_at: service.updated_at
      }
    end
  end
end
