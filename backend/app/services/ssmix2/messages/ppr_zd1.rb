module Ssmix2
  module Messages
    # 病名(PPR^ZD1、データ種別 PPR-01)。患者の全病名を PRB + ZPR で列挙し、今回書いたものを
    # AD(追加)/ UP(更新)/ DE(削除)、それ以外を UC(修正無し)にする(1 患者 1 ファイル)。
    class PprZd1 < Base
      def build
        changed = written.resource || context.last_version("Condition", written.id)
        return nil if changed.nil? || nursing_problem?(changed)

        patient = patient_of(changed.dig("subject", "reference"))
        conditions = current_conditions(patient["id"], changed)
        msh("PPR^ZD1^PPR_ZD1")
        pid(patient)
        conditions.each do |condition|
          prb(condition, action_code(condition))
          zpr(condition)
        end
        result(data_kind: "PPR-01", service_date: UNDATED, order_no: OrderNumber::NONE, process: "INS", department_code: nil)
      end

      private

      def current_conditions(patient_id, changed)
        found = context.search("Condition", { "patient" => "Patient/#{patient_id}", "_count" => 500 }, limit: 500)
                       .reject { |c| c["id"] == changed["id"] || nursing_problem?(c) }
        [changed] + found.sort_by { |c| [c["recordedDate"].to_s, c["id"].to_s] }
      end

      def nursing_problem?(condition)
        Fhir.category_code(condition, Fhir::CONDITION_LOCAL_CATEGORY_SYSTEM) == Fhir::NURSING_PROBLEM_CODE
      end

      def action_code(condition)
        return "UC" unless condition["id"] == written.id

        case written.method
        when "POST" then "AD"
        when "DELETE" then "DE"
        else "UP"
        end
      end

      def prb(condition, action)
        code = condition["code"]
        disease = Fhir.coding(code, Fhir::DISEASE_KEY_NUMBER_SYSTEM)
        icd10 = Fhir.coding(code, Fhir::ICD10_SYSTEM)&.dig("code")
        name = Fhir.display_of(code).to_s
        outcome = Fhir.status_code(condition["clinicalStatus"])
        fields = Array.new(25, "")
        fields[0] = action
        fields[1] = Hl7::Stamp.format(transaction.occurred_at)
        fields[2] = disease ? Hl7::Types.cwe(disease["code"], disease["display"] || name, "MDCDX2") : Hl7::Types.cwe("", name, "")
        fields[3] = Hl7::Types.ei(condition["id"])
        fields[6] = Hl7::Stamp.day(condition["recordedDate"])
        fields[8] = Hl7::Stamp.day(condition["abatementDateTime"])
        fields[9] = icd10 ? Hl7::Types.cwe(icd10, "", "I10") : ""
        fields[12] = suspected?(condition) ? Hl7::Types.cwe("1", "疑いあり", "JHSD0005") : ""
        fields[13] = Codes.condition_outcome_cwe(outcome)
        fields[14] = %w[resolved inactive remission].include?(outcome) ? Hl7::Stamp.day(condition["abatementDateTime"]) : ""
        fields[15] = Hl7::Stamp.day(condition["onsetDateTime"])
        fields[16] = Hl7::Types.text(name)
        builder.add("PRB", *fields)
      end

      def suspected?(condition)
        Fhir.status_code(condition["verificationStatus"]) == "provisional" ||
          modifiers(condition, Fhir::POSTFIX_MODIFIER_EXT_URL).any? { |m| m[:number] == Fhir::SUSPECTED_MODIFIER_NUMBER }
      end

      def zpr(condition)
        code = condition["code"]
        disease = Fhir.coding(code, Fhir::DISEASE_KEY_NUMBER_SYSTEM)
        return if disease.nil?

        prefixes = modifiers(condition, Fhir::PREFIX_MODIFIER_EXT_URL)
        postfixes = modifiers(condition, Fhir::POSTFIX_MODIFIER_EXT_URL)
        exchange = Fhir.coding(code, Fhir::DISEASE_EXCHANGE_SYSTEM)&.dig("code")
        name = Fhir.display_of(code).to_s
        builder.add(
          "ZPR",
          Hl7::Types.repeats(*prefixes.map { |m| Hl7::Types.cwe(m[:number], m[:name], "MDCDX2") }),
          Hl7::Types.cwe(disease["code"], disease["display"] || name, "MDCDX2"),
          Hl7::Types.repeats(*postfixes.map { |m| Hl7::Types.cwe(m[:number], m[:name], "MDCDX2") }),
          Hl7::Types.repeats(*prefixes.filter_map { |m| m[:exchange] && Hl7::Types.cwe(m[:exchange], m[:name], "MDCDX2") }),
          exchange ? Hl7::Types.cwe(exchange, name, "MDCDX2") : "",
          Hl7::Types.repeats(*postfixes.filter_map { |m| m[:exchange] && Hl7::Types.cwe(m[:exchange], m[:name], "MDCDX2") }),
          Hl7::Types.text(Array(condition["note"]).first&.dig("text"))
        )
      end

      def modifiers(condition, url)
        Array(condition.dig("code", "extension")).select { |e| e["url"] == url }.filter_map do |e|
          concept = e["valueCodeableConcept"]
          number = Fhir.coding(concept, Fhir::MODIFIER_KEY_NUMBER_SYSTEM)
          next if number.nil?

          { number: number["code"], name: number["display"] || concept["text"],
            exchange: Fhir.coding(concept, Fhir::MODIFIER_EXCHANGE_SYSTEM)&.dig("code") }
        end
      end
    end
  end
end
