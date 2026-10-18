module Admin
  # SMART アプリ(カルテから起動する外部アプリ)の登録・編集・削除。
  #
  # 起動 URL の差し替えは、医療者を偽のアプリへ誘導する経路になる。OAuth クライアント
  # 管理と同じく、本番で ADMIN_TOKEN が無いまま開けてはいけない。
  class SmartAppsController < BaseController
    before_action :require_admin_auth_configured!
    before_action :set_app, only: %i[update destroy]

    def index
      apps = SmartApp.ordered
      render json: { total: apps.size, items: apps.map { |app| summary(app) } }
    end

    def create
      app = SmartApp.new(app_params)
      app.position = next_position if params[:position].blank?
      if app.save
        render json: summary(app), status: :created
      else
        render json: { errors: app.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      if @app.update(app_params)
        render json: summary(@app)
      else
        render json: { errors: @app.errors.full_messages }, status: :unprocessable_content
      end
    end

    def destroy
      @app.destroy!
      head :no_content
    end

    private

    def set_app
      @app = SmartApp.find(params[:id])
    end

    def app_params
      params.permit(:name, :client_id, :launch_url, :display, :enabled, :position)
    end

    def next_position
      (SmartApp.maximum(:position) || 0) + 1
    end

    def require_admin_auth_configured!
      return unless Rails.env.production?
      return if ENV["ADMIN_TOKEN"].present?

      render json: { error: "ADMIN_TOKEN が未設定のため、この操作は本番環境で無効です" },
             status: :service_unavailable
    end

    def summary(app)
      {
        id: app.id,
        name: app.name,
        client_id: app.client_id,
        launch_url: app.launch_url,
        display: app.display,
        enabled: app.enabled,
        position: app.position,
        updated_at: app.updated_at
      }
    end
  end
end
