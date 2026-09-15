# 「自院」がどの Organization かを、ログイン済みユーザー全員へ返す読み取り専用の
# エンドポイント。各マスタ画面の所属既定値・帳票の自院欄がこれを見る。
#
# 書き込みは管理者だけなので Admin::FacilitySettingsController 側に置いてある。
# GET しかないので CSRF 検査は不要(verify_user_csrf! は GET を素通しする)。
class FacilitySettingsController < ActionController::API
  include UserAuthentication

  before_action :authorize_user!

  def show
    settings = FacilitySettings.current
    render json: {
      self_organization_id: settings.self_organization_id,
      nursing_schedule: settings.nursing_schedule_with_defaults,
      meal_schedule: settings.meal_schedule_with_defaults,
      vital_thresholds: settings.vital_thresholds_with_defaults,
      water_balance: settings.water_balance_with_defaults,
      medication_schedule: settings.medication_schedule_with_defaults
    }
  end
end
