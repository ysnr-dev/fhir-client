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
        meal_schedule: %i[breakfast lunch dinner],
        vital_thresholds: {},
        water_balance: { in: [], out: [] },
        medication_schedule: %i[before_meal_minutes after_meal_minutes bedtime wake_time]
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
      if params.key?(:vital_thresholds)
        attrs[:vital_thresholds] = permitted[:vital_thresholds].to_h
      end
      if params.key?(:water_balance)
        attrs[:water_balance] = permitted[:water_balance].to_h
      end
      if params.key?(:medication_schedule)
        attrs[:medication_schedule] = medication_schedule_attrs(permitted[:medication_schedule])
      end
      attrs
    end

    # 分は数値で保存する(JSON で文字列で来ても数値に寄せる。時刻は文字列のまま)。
    def medication_schedule_attrs(permitted)
      permitted.to_h.to_h do |key, value|
        if FacilitySettings::MEDICATION_SCHEDULE_MINUTE_KEYS.include?(key.to_s)
          [key, value.to_s.match?(/\A-?\d+\z/) ? value.to_i : value]
        else
          [key, value]
        end
      end
    end

    def payload(settings)
      {
        self_organization_id: settings.self_organization_fhir_id.presence,
        nursing_schedule: settings.nursing_schedule_with_defaults,
        meal_schedule: settings.meal_schedule_with_defaults,
        vital_thresholds: settings.vital_thresholds_with_defaults,
        water_balance: settings.water_balance_with_defaults,
        medication_schedule: settings.medication_schedule_with_defaults
      }
    end
  end
end
