module Auth
  # アプリ本体のログイン(ID + パスワード)。
  #
  # - 医療従事者: 医療従事者登録ページで設定したログインアカウント(users テーブル、
  #   上流 Practitioner と 1:1)で認証する。
  # - administrator: DB に置かない固定ユーザー。パスワードは管理画面ログインと
  #   同じ ENV["ADMIN_TOKEN"]。Practitioner の紐付きは無い。
  #
  # 管理画面(/admin/session)と同様、資格情報はブラウザに保持させず
  # HttpOnly のセッション Cookie を張る。
  class SessionsController < ActionController::API
    include UserAuthentication

    # GET /auth/session -- SPA が起動時にログイン状態を確認する
    def show
      render json: session_payload
    end

    # POST /auth/session
    def create
      user = authenticate_credentials(params[:login_id].to_s, params[:password].to_s)
      unless user
        # rack-attack が無いので、ごく軽い総当たり遅延を入れる(管理画面と同様)。
        sleep 0.2
        return render json: { error: "ログインIDまたはパスワードが正しくありません" },
                      status: :unauthorized
      end

      # session fixation 対策。管理画面のログインは消さずに引き継ぐ。
      reset_session_preserving(ADMIN_SESSION_KEYS)
      if user == :administrator
        session[:user_id] = ADMIN_LOGIN_ID
        session[:user_secret_digest] = secret_digest(ENV["ADMIN_TOKEN"])
      else
        session[:user_id] = user.id
        session[:user_secret_digest] = secret_digest(user.password_digest)
      end
      session[:user_authenticated_at] = Time.current.to_i
      session[:csrf_token] = SecureRandom.urlsafe_base64(32)

      render json: session_payload
    end

    # DELETE /auth/session -- アプリ本体のログインだけを消す(管理画面は残す)
    def destroy
      USER_SESSION_KEYS.each { |key| session.delete(key) }
      @current_user = nil

      render json: session_payload
    end

    private

    # 成功時は User か :administrator、失敗時は nil。
    def authenticate_credentials(login_id, password)
      return nil if login_id.blank? || password.blank?

      if login_id == ADMIN_LOGIN_ID
        expected = ENV["ADMIN_TOKEN"].presence
        return :administrator if expected &&
                                 ActiveSupport::SecurityUtils.secure_compare(password, expected)

        nil
      else
        User.find_by(login_id: login_id)&.authenticate(password) || nil
      end
    end

    def session_payload
      auth_required = ENV["ADMIN_TOKEN"].present?

      {
        # ADMIN_TOKEN 未設定なら常に認証済み扱い(管理画面と同じ後方互換)。
        authenticated: !auth_required || user_session_authenticated?,
        auth_required: auth_required,
        csrf_token: session[:csrf_token],
        user: current_user_payload
      }
    end
  end
end
