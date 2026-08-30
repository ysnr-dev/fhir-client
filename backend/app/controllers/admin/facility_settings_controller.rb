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
      # 渡されなかった項目は触らない(看護指示の既定時刻だけを保存できるように)。
      permitted = params.permit(
        :self_organization_id,
        nursing_schedule: [:interval_start, { daily: {} }],
        meal_schedule: %i[breakfast lunch dinner]
      )
      attrs = {}
      if params.key?(:self_organization_id)
        attrs[:self_organization_fhir_id] = permitted[:self_organization_id].presence
      end
      if params.key?(:nursing_schedule)
        attrs[:nursing_schedule] = permitted[:nursing_schedule].to_h
      end
      if params.key?(:meal_schedule)
        attrs[:meal_schedule] = permitted[:meal_schedule].to_h
      end
      attrs
    end

    def payload(settings)
      {
        self_organization_id: settings.self_organization_fhir_id.presence,
        nursing_schedule: settings.nursing_schedule_with_defaults,
        meal_schedule: settings.meal_schedule_with_defaults
      }
    end
  end
end
