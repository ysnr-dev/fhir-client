# 「自院」がどの Organization かと施設ごとの業務設定。ログイン済みユーザー全員が読み書きする。
# 各マスタ画面の所属既定値・帳票の自院欄、各画面の既定値がこれを見る。
#
# 設定項目ごとの分岐はここには無い。返す項目も受け取れるキーも構造の検証も
# FacilitySettings::SETTINGS(項目表)が決めるので、項目を足してもこのファイルは触らない。
class FacilitySettingsController < ActionController::API
  include UserAuthentication

  before_action :authorize_user!
  before_action :verify_user_csrf!
  before_action :set_settings

  def show
    render json: payload
  end

  def update
    apply_params
    if @settings.save
      render json: payload
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

  def payload
    { self_organization_id: @settings.self_organization_fhir_id.presence }
      .merge(@settings.settings_with_defaults)
  end
end
