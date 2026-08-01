module Admin
  # 管理UIのログイン。ADMIN_TOKEN をそのままパスフレーズとして受け取り、一致したら
  # HttpOnly のセッション Cookie を張る。
  #
  # トークンをブラウザに保持させない(sessionStorage 等に置かない)のが狙い:
  # XSS でトークンそのものを持ち去られると、curl から何度でも管理APIを叩ける
  # 資格情報になってしまう。Cookie なら HttpOnly で JS から読めない。
  class SessionsController < BaseController
    # reset_session_preserving / USER_SESSION_KEYS のため(アプリ本体のログインと
    # 同じ Cookie に同居しているので、互いに消し合わないようにする)。
    include UserAuthentication

    skip_before_action :authorize_admin!
    skip_before_action :verify_admin_csrf!

    # GET /admin/session -- SPA が起動時にログイン状態を確認する
    def show
      render json: session_payload
    end

    # POST /admin/session
    def create
      expected = ENV["ADMIN_TOKEN"].presence
      # 認証不要モード(既定)。ログイン画面を出さずに通す。
      return render(json: session_payload) if expected.nil?

      provided = params[:token].to_s
      unless provided.present? && ActiveSupport::SecurityUtils.secure_compare(provided, expected)
        # fhir-client には rack-attack が無いので、ごく軽い総当たり遅延を入れる。
        sleep 0.2
        return render json: { error: "パスフレーズが正しくありません" }, status: :unauthorized
      end

      # session fixation 対策。アプリ本体のログインは消さずに引き継ぐ。
      reset_session_preserving(UserAuthentication::USER_SESSION_KEYS)
      session[:admin_authenticated_at] = Time.current.to_i
      session[:admin_token_digest] = token_digest(expected)
      session[:csrf_token] = SecureRandom.urlsafe_base64(32)

      render json: session_payload
    end

    # DELETE /admin/session -- 管理画面のログインだけを消す(アプリ本体は残す)
    def destroy
      UserAuthentication::ADMIN_SESSION_KEYS.each { |key| session.delete(key) }

      render json: { authenticated: false, auth_required: ENV["ADMIN_TOKEN"].present?, csrf_token: nil }
    end

    private

    def session_payload
      expected = ENV["ADMIN_TOKEN"].presence

      {
        # ADMIN_TOKEN 未設定なら常に認証済み扱い(docker compose up の摩擦をゼロに保つ)。
        authenticated: expected.nil? || session_authenticated?(expected),
        auth_required: expected.present?,
        csrf_token: session[:csrf_token]
      }
    end
  end
end
