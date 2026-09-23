module Integrations
  module Receipt
    # カルテ → レセコンへの会計送信。
    class BillingsController < BaseController
      def preview
        render json: sender.preview(patient_fhir_id: params.require(:patient_id),
                                    perform_date: params.require(:date),
                                    practitioner_id: params[:practitioner_id])
      end

      def status
        result = sender.status(patient_fhir_id: params.require(:patient_id),
                               perform_date: params.require(:date),
                               department_code: params[:department_code])
        render json: {
          sent: result.sent?, state: result.state, message: result.message,
          settlements: result.settlements&.map(&:to_h)
        }.compact
      end

      # その日に会計が済んだ受診(外来一覧の印)。
      def settled
        rows = sender.settled_receptions(perform_date: params.require(:date))
        render json: { settled: rows.map(&:to_h) }
      end

      def create
        result = sender.call(
          patient_fhir_id: params.require(:patient_id),
          perform_date: params.require(:date),
          department_code: params[:department_code],
          practitioner_id: params[:practitioner_id],
          coverage_set_key: params[:coverage_set_key],
          requested_by: requested_by
        )

        render json: { billing: result_json(result[:billing]), diagnoses: result_json(result[:diagnoses]) },
               status: result[:billing].failed? ? :bad_gateway : :ok
      end

      def destroy
        result = sender.cancel(patient_fhir_id: params.require(:patient_id),
                               perform_date: params.require(:date),
                               department_code: params[:department_code],
                               requested_by: requested_by)

        render json: result_json(result), status: result.failed? ? :bad_gateway : :ok
      end

      private

      def sender = @sender ||= ReceiptComputer::BillingSender.new
    end
  end
end
