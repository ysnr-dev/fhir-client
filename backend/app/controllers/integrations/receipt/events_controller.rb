module Integrations
  module Receipt
    # 院内エージェント(fhir-client-agent)から届く通知の受け口。
    #
    # ブラウザからは呼ばれないので、ログインセッションではなく発行済みの
    # トークンで認証する。ペイロードは連携先に依らない中立の形で、
    # レセコンの電文形式(WebSocket のイベント)は院内エージェント側で吸収する。
    class EventsController < ActionController::API
      before_action :authorize_bridge!

      rescue_from ArgumentError, with: :render_bad_request
      rescue_from ReceiptComputer::NotConfigured, with: :render_unavailable
      rescue_from ReceiptComputer::NotFound, with: :render_unprocessable

      def create
        handler.call(event_params)
        # 受け取って処理したことだけを返す。院内エージェントは結果を使わない。
        head :accepted
      rescue ReceiptComputer::Unreachable, FhirStore::UpstreamError => e
        # 院内エージェントに再送させる。通知は再配達されないので、ここで捨てない。
        render json: { error: e.message }, status: :service_unavailable
      end

      private

      def handler = @handler ||= ReceiptComputer::EventHandler.new

      def event_params
        params.permit(:event_id, :type, :occurred_at, :patient_number,
                      reception: %i[key date time department_code physician_code coverage_set_key])
              .to_h.with_indifferent_access
      end

      def authorize_bridge!
        expected = ReceiptComputer.connection.inbound_token
        return render json: { error: "receipt_disabled" }, status: :not_found if expected.blank?

        provided = request.headers["Authorization"].to_s.delete_prefix("Bearer ")
        return if provided.present? && ActiveSupport::SecurityUtils.secure_compare(provided, expected)

        render json: { error: "unauthorized" }, status: :unauthorized
      end

      def render_bad_request(exception)
        render json: { error: exception.message }, status: :bad_request
      end

      def render_unavailable(exception)
        render json: { error: exception.message }, status: :service_unavailable
      end

      def render_unprocessable(exception)
        render json: { error: exception.message }, status: :unprocessable_entity
      end
    end
  end
end
