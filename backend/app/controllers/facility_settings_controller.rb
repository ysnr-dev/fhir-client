# 「自院」がどの Organization かを、ログイン済みユーザー全員へ返す読み取り専用の
# エンドポイント。各マスタ画面の所属既定値・帳票の自院欄がこれを見る。
#
# 書き込みは管理者だけなので Admin::FacilitySettingsController 側に置いてある。
# GET しかないので CSRF 検査は不要(verify_user_csrf! は GET を素通しする)。
class FacilitySettingsController < ActionController::API
  include UserAuthentication

  before_action :authorize_user!

  def show
    render json: { self_organization_id: FacilitySettings.self_organization_id }
  end
end
