module Ssmix2
  module Messages
    # 担当医の変更(ADT^A54、データ種別 ADT-01)と取消(ADT^A55)。在院中の Encounter の participant(ATND)が
    # 前の版と変わったときに起こす。入院登録(A01)と入院予定(A14)は PV1-7 で主治医を運ぶのでここでは扱わない。
    class EncounterAttendingAdt < Base
      def build
        encounter = written.resource
        return nil if encounter.nil? || !inpatient?(encounter) || !%w[in-progress finished].include?(encounter["status"])

        previous = previous_version("Encounter", encounter)
        return nil if previous.nil? || previous["status"] == "planned"

        before = Fhir.participant_reference(previous, "ATND")
        after = Fhir.participant_reference(encounter, "ATND")
        return nil if before == after

        patient = patient_of(encounter.dig("subject", "reference"))
        removed = after.blank?
        msh(removed ? "ADT^A55^ADT_A52" : "ADT^A54^ADT_A54")
        evn
        pid(patient)
        pv1(patient, encounter: encounter, extra: removed ? { 7 => practitioner_xcn(before) } : {})
        result(data_kind: "ADT-01", service_date: UNDATED, order_no: OrderNumber.for("Encounter/#{encounter['id']}#A54"),
               process: removed ? "DEL" : "INS", department_code: department_code_of(encounter.dig("serviceProvider", "reference")))
      end
    end
  end
end
