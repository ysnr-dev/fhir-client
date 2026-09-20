module Integrations
  module Receipt
    # 患者・保険をレセコンから取り直す。
    #
    # 通知を取りこぼしたときの回復手段。通知経由と同じ道を通す。
    class PatientsController < BaseController
      def refresh
        patient = store.read("Patient", params.require(:patient_id))
        number = ReceiptComputer::PatientResource.number_of(patient)
        raise ReceiptComputer::NotFound, "患者番号が登録されていません" if number.blank?

        result = handler.import_patient(number)
        ReceiptComputer.log.write(direction: :in, action: "patient.refresh", outcome: "succeeded",
                                  patient_number: number, requested_by: requested_by, **result)

        render json: result
      end

      private

      def store = @store ||= FhirStore.new

      def handler = @handler ||= ReceiptComputer::EventHandler.new(store: store)
    end
  end
end
