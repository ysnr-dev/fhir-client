module Integrations
  module Ssmix2
    # 院内エージェント(fhir-client-agent、ssmix2-storage)向けの受け口。ブラウザからは呼ばれないので、
    # 管理画面「外部システム連携」の ssmix2_storage で発行したトークンで認証する。
    class BaseController < ActionController::API
      SYSTEM_KEY = "ssmix2_storage".freeze

      before_action :authorize_agent!

      private

      def authorize_agent!
        expected = ExternalSystemConnection.effective(SYSTEM_KEY).inbound_token
        return render json: { error: "ssmix2_token_unset" }, status: :not_found if expected.blank?

        provided = request.headers["Authorization"].to_s.delete_prefix("Bearer ")
        return if provided.present? && ActiveSupport::SecurityUtils.secure_compare(provided, expected)

        render json: { error: "unauthorized" }, status: :unauthorized
      end
    end
  end
end
