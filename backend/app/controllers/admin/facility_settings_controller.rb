module Admin
  # 管理用: 「自院」の Organization と施設ごとの業務設定を書き換える。読み取り
  # (全ユーザー向け)は FacilitySettingsController 側にあり、こちらは管理者専用。
  #
  # 設定項目ごとの分岐はここには無い。受け取れるキーも構造の検証も
  # FacilitySettings::SETTINGS(項目表)が決めるので、項目を足してもこのファイルは
  # 触らない。
  class FacilitySettingsController < BaseController
    before_action :set_settings, only: %i[show update]

    def show
      render json: payload(@settings)
    end

    def update
      apply_params
      if @settings.save
        render json: payload(@settings)
      else
        render json: { errors: @settings.errors.full_messages }, status: :unprocessable_content
      end
    end

    private

    def set_settings
      @settings = FacilitySettings.current
    end

    # 渡されなかった項目は触らない(看護指示の既定時刻だけを保存できるように)。
    # 自院の空文字は「指定を外す」意味なので nil に寄せる。
    def apply_params
      permitted = params.permit(:self_organization_id, **FacilitySettings::SETTINGS.keys.index_with({}))

      if params.key?(:self_organization_id)
        @settings.self_organization_fhir_id = permitted[:self_organization_id].presence
      end

      incoming = FacilitySettings::SETTINGS.keys.select { |key| params.key?(key) }
                                           .index_with { |key| permitted[key].to_h.deep_stringify_keys }
      @settings.apply_settings(incoming)
    end

    def payload(settings)
      { self_organization_id: settings.self_organization_fhir_id.presence }
        .merge(settings.settings_with_defaults)
    end
  end
end
