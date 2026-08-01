# アプリ本体(/fhir・/master・/reports・/auth)のログイン認証。
#
# 管理画面(Admin::BaseController)と同じ設計で、受理する経路も同じ3通り:
#
#   1. ログインセッション(HttpOnly Cookie)。ブラウザ向け。ID/パスワードは
#      Auth::SessionsController が検証する。
#   2. Authorization: Bearer / X-Admin-Token ヘッダ(値は ADMIN_TOKEN)。
#      curl・CI・運用ツール向け。Cookie を使わないので CSRF 検査の対象外。
#   3. ADMIN_TOKEN 未設定 -- 認証なし(docker compose up の摩擦をゼロに保つ
#      後方互換。auth_required=false としてフロントもログイン画面を出さない)。
#
# セッションは管理画面と同じ Cookie(path=/)に同居するが、キーは user_* で
# 分離し、互いのログイン/ログアウトで消し合わないようにする。
module UserAuthentication
  extend ActiveSupport::Concern

  SESSION_TTL = 12.hours
  ADMIN_LOGIN_ID = "administrator".freeze
  USER_SESSION_KEYS = %i[user_id user_authenticated_at user_secret_digest].freeze
  ADMIN_SESSION_KEYS = %i[admin_authenticated_at admin_token_digest].freeze

  included do
    # api_only なので明示的に取り込む(ミドルウェアは config/application.rb)。
    include ActionController::Cookies
  end

  private

  def authorize_user!
    expected = ENV["ADMIN_TOKEN"].presence

    if user_session_authenticated?
      @user_auth = :session
    elsif expected && user_header_token_matches?(expected)
      @user_auth = :header
    elsif expected.nil?
      @user_auth = :none
    else
      render json: { error: "unauthorized" }, status: :unauthorized
    end
  end

  # CSRF: Admin::BaseController#verify_admin_csrf! と同じ手書き synchronizer
  # token。セッション認証のときだけ検査する(ヘッダ経路の運用ツールを壊さない)。
  # トークンはログイン時に session に保存され、/auth/session の応答で SPA に渡る。
  def verify_user_csrf!
    return if request.get? || request.head?
    return unless @user_auth == :session

    expected = session[:csrf_token]
    provided = request.headers["X-CSRF-Token"]
    return if expected.present? && provided.present? &&
              ActiveSupport::SecurityUtils.secure_compare(provided, expected)

    render json: { error: "invalid_csrf_token" }, status: :forbidden
  end

  def user_session_authenticated?
    authenticated_at = session[:user_authenticated_at]
    return false if authenticated_at.blank?
    return false if Time.zone.at(authenticated_at) <= SESSION_TTL.ago

    # administrator は ADMIN_TOKEN のローテートで、DB ユーザーはパスワード変更・
    # アカウント削除で既存セッションを失効させる。Cookie に秘密そのものは載せない。
    expected_digest =
      if administrator_session?
        admin_token = ENV["ADMIN_TOKEN"].presence
        admin_token && secret_digest(admin_token)
      else
        current_user && secret_digest(current_user.password_digest)
      end

    expected_digest.present? && session[:user_secret_digest] == expected_digest
  end

  def administrator_session?
    session[:user_id] == ADMIN_LOGIN_ID
  end

  def current_user
    return nil if administrator_session?

    @current_user ||= User.find_by(id: session[:user_id])
  end

  # /auth/session の応答と後続機能(処方オーダーの依頼者など)が使う
  # 「いまログインしているのは誰か」。practitioner_id は上流 Practitioner の ID。
  def current_user_payload
    return nil unless user_session_authenticated?

    if administrator_session?
      { login_id: ADMIN_LOGIN_ID, practitioner_id: nil, administrator: true }
    else
      {
        login_id: current_user.login_id,
        practitioner_id: current_user.practitioner_fhir_id,
        administrator: false
      }
    end
  end

  def user_header_token_matches?(expected)
    provided = user_token_from_request
    provided.present? && ActiveSupport::SecurityUtils.secure_compare(provided, expected)
  end

  def user_token_from_request
    auth = request.headers["Authorization"].to_s
    return auth.split(" ", 2).last if auth.start_with?("Bearer ")

    request.headers["X-Admin-Token"].presence
  end

  def secret_digest(value)
    OpenSSL::Digest::SHA256.hexdigest(value)
  end

  # ログイン時の session fixation 対策。素の reset_session だと同居している
  # もう一方(管理画面 or アプリ本体)のログインまで消えてしまうので、
  # 指定キーだけ引き継いでセッションを作り直す。
  def reset_session_preserving(keys)
    preserved = keys.index_with { |key| session[key] }
    reset_session
    preserved.each { |key, value| session[key] = value unless value.nil? }
  end
end
