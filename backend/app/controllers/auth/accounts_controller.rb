module Auth
  # 医療従事者のログインアカウント管理。医療従事者登録ページが Practitioner を
  # 上流 FHIR サーバーへ保存した後に、その ID を添えてここを呼ぶ。
  # practitioner_id(上流 Practitioner の ID)をキーに upsert / 削除する。
  class AccountsController < ActionController::API
    include UserAuthentication

    before_action :authorize_user!
    before_action :verify_user_csrf!

    rescue_from ActionController::ParameterMissing do
      render json: { error: "practitioner_id を指定してください" }, status: :bad_request
    end

    # GET /auth/account?practitioner_id=X -- ログイン設定の有無と login_id を返す。
    # パスワード(ダイジェスト含む)は返さない。
    def show
      render json: account_payload(find_account)
    end

    # PUT /auth/account -- { practitioner_id, login_id, password } で upsert。
    # 既存アカウントの更新時はパスワード省略可(変更しない)。
    def update
      user = User.find_or_initialize_by(practitioner_fhir_id: params.require(:practitioner_id))
      user.login_id = params[:login_id].to_s
      password = params[:password].to_s
      user.password = password if password.present? || user.new_record?

      if user.save
        render json: account_payload(user)
      else
        render json: { errors: user.errors.full_messages }, status: :unprocessable_content
      end
    end

    # DELETE /auth/account?practitioner_id=X -- ログインを無効化(アカウント削除)。
    # 対象が無くても成功扱い(冪等)。
    def destroy
      find_account&.destroy!

      render json: account_payload(nil)
    end

    private

    def find_account
      User.find_by(practitioner_fhir_id: params.require(:practitioner_id))
    end

    def account_payload(user)
      if user&.persisted?
        { registered: true, login_id: user.login_id }
      else
        { registered: false, login_id: nil }
      end
    end
  end
end
