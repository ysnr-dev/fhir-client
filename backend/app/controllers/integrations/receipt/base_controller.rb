module Integrations
  module Receipt
    # レセコン連携のユーザー向けエンドポイント。Master::BaseController と同じく
    # アプリ本体のログイン認証を使う(FHIR リソースではないので OperationOutcome は返さない)。
    #
    # 連携が無効な環境では 404 を返し、フロントは連携UIを出さない。
    class BaseController < ActionController::API
      include UserAuthentication

      before_action :authorize_user!
      before_action :verify_user_csrf!
      before_action :require_receipt_enabled!

      rescue_from ReceiptComputer::NotConfigured, with: :render_not_configured
      rescue_from ReceiptComputer::NotFound, with: :render_not_found
      rescue_from ReceiptComputer::Unreachable, with: :render_unreachable
      rescue_from ReceiptComputer::Rejected, with: :render_rejected
      rescue_from FhirStore::NotFound, with: :render_not_found
      rescue_from FhirStore::UpstreamError, FhirStore::AmbiguousMatch, with: :render_rejected
      rescue_from Faraday::ConnectionFailed, Faraday::TimeoutError, with: :render_unreachable

      private

      def receipt_config
        @receipt_config ||= ReceiptComputer.connection
      end

      def require_receipt_enabled!
        render json: { error: "receipt_disabled" }, status: :not_found unless receipt_config.usable?
      end

      # 操作した利用者。ログに「誰が送ったか」を残す。
      def requested_by
        session[:user_id].presence || "unknown"
      end

      def result_json(result)
        return nil if result.nil?

        {
          outcome: result.outcome.to_s,
          code: result.code,
          message: result.message,
          warnings: result.warnings,
          skipped: result.skipped
        }
      end

      def render_not_configured(exception)
        render json: { error: exception.message }, status: :service_unavailable
      end

      def render_rejected(exception)
        render json: { error: exception.message }, status: :bad_gateway
      end

      def render_unreachable(exception)
        render json: { error: "医事会計システムに接続できませんでした (#{exception.class})" }, status: :bad_gateway
      end

      def render_not_found(exception)
        render json: { error: exception.message }, status: :not_found
      end
    end
  end
end
