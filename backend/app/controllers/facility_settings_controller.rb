# 「自院」がどの Organization かと施設ごとの業務設定を、ログイン済みユーザー全員へ返す
# 読み取り専用のエンドポイント。各マスタ画面の所属既定値・帳票の自院欄、各画面の
# 既定値がこれを見る。返す項目は FacilitySettings::SETTINGS(項目表)が決める。
#
# 書き込みは管理者だけなので Admin::FacilitySettingsController 側に置いてある。
# GET しかないので CSRF 検査は不要(verify_user_csrf! は GET を素通しする)。
class FacilitySettingsController < ActionController::API
  include UserAuthentication

  before_action :authorize_user!

  def show
    settings = FacilitySettings.current
    render json: { self_organization_id: settings.self_organization_id }
      .merge(settings.settings_with_defaults)
  end
end
