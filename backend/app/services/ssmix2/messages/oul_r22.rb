module Ssmix2
  module Messages
    # 検体検査結果(OUL^R22、データ種別 OML-11)。DiagnosticReport とその result の Observation から、
    # 検体ごとに SPM、その下に OBR / ORC と結果の OBX を組む。訂正報告も INS(受け側で前の有効が過去履歴になる)。
    class OulR22 < Base
      def build
        report = written.resource || context.last_version("DiagnosticReport", written.id)
        return nil if report.nil? || !lab_report?(report)

        patient = patient_of(report.dig("subject", "reference"))
        observations = observations_of(report)
        specimens = specimens_of(report)
        deleted = written.method == "DELETE" || cancelled?(report)
        order_no = order_number(report)
        inpatient = inpatient_setting?(report, Fhir::LAB_RESULT_SETTING_SYSTEM)
        department = department_code_of(Fhir.department_reference(report))
        collected = specimens.filter_map { |s| s.dig("collection", "collectedDateTime") }.first || report["effectiveDateTime"]

        msh("OUL^R22^OUL_R22")
        pid(patient)
        pv1(patient, encounter: inpatient ? :current : nil, department_code: department)
        groups = group_by_specimen(observations, specimens)
        groups.each_with_index do |(specimen, group), index|
          spm(specimen, index + 1, report)
          obr(order_no, report, index + 1)
          orc(deleted ? "CA" : "SC", order_no, nil, inpatient: inpatient, extra: { 3 => Hl7::Types.ei(report["id"]), 5 => order_status(report) })
          group.each_with_index { |observation, i| obx_result(observation, i + 1) }
        end
        result(data_kind: "OML-11", service_date: Hl7::Stamp.day(collected), order_no: order_no,
               process: deleted ? "DEL" : "INS", department_code: department)
      end

      private

      def lab_report?(report)
        Array(report["category"]).any? { |c| Array(c["coding"]).any? { |coding| coding["code"] == "LAB" } }
      end

      # 元オーダーの番号。basedOn が無い結果は DiagnosticReport で採番する。
      def order_number(report)
        header = Array(report["basedOn"]).map { |b| b["reference"] }.find { |r| r.to_s.start_with?("ServiceRequest/") }
        OrderNumber.for(header || "DiagnosticReport/#{report['id']}")
      end

      def observations_of(report)
        ids = Array(report["result"]).filter_map { |r| Fhir.reference_id(r["reference"]) }
        seed_transaction_resources("Observation")
        context.preload("Observation", ids)
        ids.filter_map { |id| context.resource("Observation", id) }
      end

      def specimens_of(report)
        ids = Array(report["specimen"]).filter_map { |r| Fhir.reference_id(r["reference"]) }
        seed_transaction_resources("Specimen")
        context.preload("Specimen", ids)
        ids.filter_map { |id| context.resource("Specimen", id) }
      end

      def seed_transaction_resources(type)
        Dispatcher.written_resources(transaction).each { |w| context.seed(w.resource) if w.type == type && w.resource }
      end

      def group_by_specimen(observations, specimens)
        by_specimen = observations.group_by { |o| Fhir.reference_id(o.dig("specimen", "reference")) }
        groups = specimens.map { |s| [s, by_specimen.delete(s["id"]) || []] }
        rest = by_specimen.values.flatten
        if rest.any?
          groups.any? ? groups.first[1].concat(rest) : groups << [nil, rest]
        end
        groups
      end

      def spm(specimen, sequence, report)
        type = specimen&.dig("type")
        coding = Fhir.coding(type, Fhir::JLAC11_SPECIMEN_SYSTEM) || Fhir.first_coding(type)
        fields = Array.new(27, "")
        fields[0] = sequence.to_s
        fields[1] = specimen ? Hl7::Types.ei(specimen.dig("accessionIdentifier", "value")) : ""
        fields[3] = coding ? Hl7::Types.cwe(coding["code"], coding["display"] || type&.dig("text"), "JC11") : ""
        fields[16] = Hl7::Stamp.format(specimen&.dig("collection", "collectedDateTime") || report["effectiveDateTime"])
        builder.add("SPM", *fields)
      end

      def obr(order_no, report, sequence)
        fields = Array.new(31, "")
        fields[0] = sequence.to_s
        fields[1] = Hl7::Types.ei(order_no)
        fields[2] = Hl7::Types.ei(report["id"])
        fields[3] = Hl7::Types.cwe("", "検体検査", "99O03")
        fields[6] = Hl7::Stamp.format(report["effectiveDateTime"])
        fields[21] = Hl7::Stamp.format(report["issued"])
        fields[24] = Codes.result_status(report["status"])
        builder.add("OBR", *fields)
      end

      def order_status(report)
        report["status"] == "preliminary" ? "A" : "CM"
      end

      def obx_result(observation, sequence)
        value_type, value, unit = observation_value(observation)
        code = observation["code"]
        jlac10 = Fhir.coding(code, Fhir::JLAC10_SYSTEM)
        jlac11 = Fhir.coding(code, Fhir::JLAC11_SYSTEM)
        local = Fhir.coding(code, Fhir::RESULT_ITEM_SYSTEM)
        short = Fhir.coding(code, Fhir::ABBREVIATION_SYSTEM)&.dig("display")
        name = Fhir.display_of(code)
        standard = jlac10 ? [jlac10["code"], jlac10["display"] || name, "JC10"] : (jlac11 ? [jlac11["code"], jlac11["display"] || name, "JC11"] : nil)
        code_cwe = if standard
                     Hl7::Types.cwe(*standard, alt: [local&.dig("code"), short || name, "99X03"])
                   else
                     Hl7::Types.cwe(local&.dig("code"), short || name, "99X03")
                   end
        range = Array(observation["referenceRange"]).first
        fields = Array.new(19, "")
        fields[0] = sequence.to_s
        fields[1] = value_type
        fields[2] = code_cwe
        fields[4] = value
        fields[5] = unit
        fields[6] = range ? Hl7::Types.text(range["text"].presence || [range.dig("low", "value"), range.dig("high", "value")].join("-")) : ""
        fields[7] = Codes.abnormal_flag(Fhir.first_coding(Array(observation["interpretation"]).first)&.dig("code"))
        fields[10] = Codes.result_status(observation["status"])
        fields[13] = Hl7::Stamp.format(observation["effectiveDateTime"])
        builder.add("OBX", *fields)
        Array(observation["note"]).each_with_index { |note, i| builder.add("NTE", (i + 1).to_s, "", Hl7::Types.text(note["text"])) }
      end

      def observation_value(observation)
        if (quantity = observation["valueQuantity"])
          unit_name = quantity["unit"].to_s
          unit = unit_name.present? ? Hl7::Types.cwe(quantity["code"].presence || unit_name, unit_name, quantity["code"].present? ? "UCUM" : "99XYZ") : ""
          ["NM", Hl7::Types.text(quantity["value"]), unit]
        elsif (concept = observation["valueCodeableConcept"])
          coding = Fhir.first_coding(concept)
          ["CWE", coding ? Hl7::Types.cwe(coding["code"], coding["display"] || concept["text"], "99XVL") : Hl7::Types.cwe("", concept["text"], ""), ""]
        else
          ["ST", Hl7::Types.text(observation["valueString"] || observation["valueInteger"] || observation["valueBoolean"]), ""]
        end
      end
    end
  end
end
