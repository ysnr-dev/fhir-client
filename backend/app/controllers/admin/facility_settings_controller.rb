module Admin
  # 管理用: 「自院」の Organization を指定する。読み取り(全ユーザー向け)は
  # FacilitySettingsController 側にあり、こちらは書き込みができる管理者専用。
  class FacilitySettingsController < BaseController
    before_action :set_settings, only: %i[show update]

    def show
      render json: payload(@settings)
    end

    def update
      if @settings.update(settings_params)
        render json: payload(@settings)
      else
        render json: { errors: @settings.errors.full_messages }, status: :unprocessable_content
      end
    end

    private

    def set_settings
      @settings = FacilitySettings.current
    end

    def settings_params
      # master コントローラと同様にフラットな params を許可する。
      # 空文字は「自院の指定を外す」意味なので nil に寄せる。
      permitted = params.permit(:self_organization_id)
      { self_organization_fhir_id: permitted[:self_organization_id].presence }
    end

    def payload(settings)
      { self_organization_id: settings.self_organization_fhir_id.presence }
    end
  end
end
