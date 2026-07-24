module Admin
  # Plain JSON REST base for the admin endpoints (connection settings). Mirrors
  # Master::BaseController: not FHIR resources, so no OperationOutcome / FHIR
  # content types — errors are `{ error: ... }` / `{ errors: [...] }`.
  class BaseController < ActionController::API
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

    before_action :authorize_admin!

    private

    # 任意の認証ガード。ADMIN_TOKEN が設定されているときだけ、
    # `Authorization: Bearer <token>` または `X-Admin-Token` ヘッダの一致を要求する。
    # 未設定なら no-op（既存の「認証なし」デフォルトを維持し、後方互換）。
    # 本番公開前は ADMIN_TOKEN の設定を強く推奨(secret 上書き・向き先変更が可能なため)。
    def authorize_admin!
      expected = ENV["ADMIN_TOKEN"].presence
      return if expected.nil?

      provided = admin_token_from_request
      return if provided.present? &&
                ActiveSupport::SecurityUtils.secure_compare(provided, expected)

      render json: { error: "unauthorized" }, status: :unauthorized
    end

    def admin_token_from_request
      auth = request.headers["Authorization"].to_s
      return auth.split(" ", 2).last if auth.start_with?("Bearer ")

      request.headers["X-Admin-Token"].presence
    end

    def render_not_found
      render json: { error: "not_found" }, status: :not_found
    end
  end
end
