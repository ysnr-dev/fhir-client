module Admin
  # Plain JSON REST base for the admin endpoints. Mirrors Master::BaseController:
  # not FHIR resources, so no OperationOutcome / FHIR content types — errors are
  # `{ error: ... }` / `{ errors: [...] }`.
  class BaseController < ActionController::API
    # api_only なので明示的に取り込む(Cookies/Session ミドルウェアは
    # config/application.rb で積んでいる)。
    include ActionController::Cookies

    SESSION_TTL = 12.hours

    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

    before_action :authorize_admin!
    before_action :verify_admin_csrf!

    private

    # 認証ガード。次の3通りを受理する:
    #
    #   1. 管理UIのログインセッション(HttpOnly Cookie)。ブラウザ向け。
    #   2. Authorization: Bearer / X-Admin-Token ヘッダ。curl・CI・既存の運用
    #      ツール向け。この経路は CSRF 検査の対象外(Cookie を使わないので
    #      ブラウザが勝手に付けることがない)。
    #   3. ADMIN_TOKEN 未設定 -- 従来どおり認証なし(後方互換)。
    #
    # 本番公開前は ADMIN_TOKEN の設定を強く推奨(secret 上書き・向き先変更・
    # OAuthクライアントの発行/削除が可能なため)。
    def authorize_admin!
      expected = ENV["ADMIN_TOKEN"].presence

      if session_authenticated?(expected)
        @admin_auth = :session
      elsif expected && header_token_matches?(expected)
        @admin_auth = :header
      elsif expected.nil?
        @admin_auth = :none
      else
        render json: { error: "unauthorized" }, status: :unauthorized
      end
    end

    def session_authenticated?(expected)
      authenticated_at = session[:admin_authenticated_at]
      return false if authenticated_at.blank?
      return false if Time.zone.at(authenticated_at) <= SESSION_TTL.ago
      # ADMIN_TOKEN をローテートしたら既存セッションを失効させる。ダイジェストを
      # 突き合わせているのは、Cookie 自体に秘密を載せずに同じ効果を得るため。
      return false if expected && session[:admin_token_digest] != token_digest(expected)

      true
    end

    def header_token_matches?(expected)
      provided = admin_token_from_request
      provided.present? && ActiveSupport::SecurityUtils.secure_compare(provided, expected)
    end

    def admin_token_from_request
      auth = request.headers["Authorization"].to_s
      return auth.split(" ", 2).last if auth.start_with?("Bearer ")

      request.headers["X-Admin-Token"].presence
    end

    # CSRF: 手書きの synchronizer token。ActionController::API は
    # RequestForgeryProtection を含まず、JSON SPA にマスク済みトークンの利点も
    # ない。加えて検査は「セッション認証のときだけ」でなければならない
    # (ヘッダ経路の運用ツールを壊さないため)ので、条件付きにできる素の実装にする。
    #
    # トークンはログイン時に生成して session に保存し、レスポンスボディで返す。
    # JS から読める Cookie には入れない(double-submit より強い: サブドメインから
    # 上書きできない)。SPA は非GETに X-CSRF-Token を付ける。
    def verify_admin_csrf!
      return if request.get? || request.head?
      return unless @admin_auth == :session

      expected = session[:csrf_token]
      provided = request.headers["X-CSRF-Token"]
      return if expected.present? && provided.present? &&
                ActiveSupport::SecurityUtils.secure_compare(provided, expected)

      render json: { error: "invalid_csrf_token" }, status: :forbidden
    end

    def token_digest(value)
      OpenSSL::Digest::SHA256.hexdigest(value)
    end

    def render_not_found
      render json: { error: "not_found" }, status: :not_found
    end
  end
end
