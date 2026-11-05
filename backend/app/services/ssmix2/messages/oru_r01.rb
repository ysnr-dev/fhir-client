module Ssmix2
  module Messages
    # 生理検査結果(ORU^R01、データ種別 OMG-13)。生理検査の所見レポート(DiagnosticReport、category が order-type の
    # physio)と result の所見 Observation から組む。所見は OBX の TX、判定(conclusion)も OBX に置く。
    # 訂正(amended)も INS(受け側で前の有効が過去履歴になる)。
    class OruR01 < Base
      include ExamOrderSegments

      def build
        report = written.resource || context.last_version("DiagnosticReport", written.id)
        return nil if report.nil? || Fhir.category_code(report, Fhir::ORDER_TYPE_SYSTEM) != "physio"

        spec = KINDS["physio"]
        patient = patient_of(report.dig("subject", "reference"))
        header_reference = Fhir.reference_of_type(report["basedOn"], "ServiceRequest")
        header = header_reference && context.by_reference(header_reference)
        leaves = header ? exam_items(header, spec) : []
        deleted = written.method == "DELETE" || cancelled?(report)
        order_no = OrderNumber.for(header ? "ServiceRequest/#{header['id']}" : "DiagnosticReport/#{report['id']}")
        inpatient = inpatient_setting?(report, Fhir::PRESCRIPTION_SETTING_SYSTEM)
        department = department_code_of(Fhir.department_reference(report))
        performed = report["effectiveDateTime"] || report["issued"]

        msh("ORU^R01^ORU_R01")
        pid(patient)
        pv1(patient, encounter: encounter_for(report, inpatient), department_code: department)
        orc(deleted ? "CA" : "SC", order_no, header, inpatient: inpatient,
            extra: { 3 => Hl7::Types.ei(report["id"]), 5 => report["status"] == "preliminary" ? "A" : "CM" })
        exam_obr(order_no, exam_code_cwe(spec, leaves), header,
                 extra: { 1 => "1", 3 => Hl7::Types.ei(report["id"]), 7 => Hl7::Stamp.format(performed, precision: :minute),
                          22 => Hl7::Stamp.format(report["issued"]), 25 => Codes.result_status(report["status"]) })
        sequence = 0
        observations_of(report).each do |observation|
          sequence += 1
          obx_text(sequence, observation_code_cwe(observation), observation_text(observation), observation["status"], observation["effectiveDateTime"])
        end
        if report["conclusion"].present?
          sequence += 1
          obx_text(sequence, Hl7::Types.cwe("conclusion", "判定", "99ZPF"), report["conclusion"], report["status"], performed)
        end
        result(data_kind: "OMG-13", service_date: Hl7::Stamp.day(performed), order_no: order_no,
               process: deleted ? "DEL" : "INS", department_code: department)
      end

      private

      # OBR-4。明細が 1 項目ならその項目、複数なら検査種別。
      def exam_code_cwe(spec, leaves)
        return "" if leaves.empty?
        return item_code_cwe(spec, leaves.first) if leaves.size == 1

        parent_code_cwe(spec, leaves)
      end

      def observations_of(report)
        ids = Array(report["result"]).filter_map { |r| Fhir.reference_id(r["reference"]) }
        Dispatcher.written_resources(transaction, all: true).each { |w| context.seed(w.resource) if w.type == "Observation" && w.resource }
        context.preload("Observation", ids)
        ids.filter_map { |id| context.resource("Observation", id) }
      end

      def observation_code_cwe(observation)
        coding = Fhir.coding(observation["code"], Fhir::PHYSIO_REPORT_ITEM_SYSTEM) || Fhir.first_coding(observation["code"])
        Hl7::Types.cwe(coding&.dig("code"), coding&.dig("display") || Fhir.display_of(observation["code"]), "99ZPF")
      end

      def observation_text(observation)
        observation["valueString"] || Fhir.display_of(observation["valueCodeableConcept"]) ||
          observation.dig("valueQuantity", "value")&.to_s || ""
      end

      def obx_text(sequence, code_cwe, text, status, at)
        fields = Array.new(14, "")
        fields[0] = sequence.to_s
        fields[1] = "TX"
        fields[2] = code_cwe
        fields[4] = Hl7::Types.text(text)
        fields[10] = Codes.result_status(status)
        fields[13] = Hl7::Stamp.format(at)
        builder.add("OBX", *fields)
      end
    end
  end
end
