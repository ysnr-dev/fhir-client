module Integrations
  module ReceiptComputer
    # 中立の保険・公費 → JP_Coverage。
    #
    # 保険と公費はそれぞれ 1 つの Coverage にする(JP Core は 1 リソース 1 保険)。
    # 「どれとどれを同時に使うか」= 請求セットは class に載せる。セットのキーは
    # レセコンが採番した不透明な値として扱い、カルテは解釈しない。
    module CoverageResource
      INSURER_NUMBER_SYSTEM = "urn:oid:1.2.392.100495.20.3.61".freeze
      INSURED_SYMBOL_EXT = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Coverage_InsuredPersonSymbol".freeze
      INSURED_NUMBER_EXT = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Coverage_InsuredPersonNumber".freeze
      INSURED_SUBNUMBER_EXT = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Coverage_InsuredPersonSubNumber".freeze
      COPAY_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/coverage-copay-type".freeze
      RELATIONSHIP_SYSTEM = "http://terminology.hl7.org/CodeSystem/subscriber-relationship".freeze

      module_function

      def identifier_value(patient_number, external_key) = "#{patient_number}:#{external_key}"

      def identifier_query(patient_number, external_key)
        "#{ReceiptComputer::COVERAGE_IDENTIFIER_SYSTEM}|#{identifier_value(patient_number, external_key)}"
      end

      # record を 1 つの Coverage にする。sets はその保険が属する請求セット。
      def build(record, patient_number:, patient_fhir_id:, sets:, order: nil)
        {
          "resourceType" => "Coverage",
          "identifier" => [{
            "system" => ReceiptComputer::COVERAGE_IDENTIFIER_SYSTEM,
            "value" => identifier_value(patient_number, record.external_key)
          }],
          "status" => "active",
          "type" => type_of(record),
          "beneficiary" => { "reference" => "Patient/#{patient_fhir_id}" },
          "relationship" => relationship_of(record),
          "subscriberId" => record.recipient_number.presence,
          "period" => period_of(record),
          # 保険者は Organization を作らずに論理参照で指す。連携のたびに
          # 保険者マスタを起こすと、カルテ側に誰も使わない施設が積み上がる。
          "payor" => [payor_of(record)],
          "class" => class_entries(sets),
          "costToBeneficiary" => cost_of(record),
          "order" => order,
          "extension" => extensions(record)
        }.compact_blank
      end

      def type_of(record)
        return nil if record.type_code.blank? && record.type_name.blank?

        coding = if record.type_code.present?
                   [{ "system" => ReceiptComputer::COVERAGE_TYPE_SYSTEM,
                      "code" => record.type_code,
                      "display" => record.type_name.presence }.compact]
                 end
        { "coding" => coding, "text" => record.type_name.presence }.compact
      end

      def relationship_of(record)
        return nil if record.relationship.blank?

        { "coding" => [{ "system" => RELATIONSHIP_SYSTEM, "code" => record.relationship }] }
      end

      def period_of(record)
        period = { "start" => record.period_start.presence, "end" => record.period_end.presence }.compact
        period.presence
      end

      # payor は 1..* が必須。保険者番号が無いもの(自費など)でも名称だけで満たす。
      def payor_of(record)
        if record.insurer_number.present?
          {
            "identifier" => { "system" => INSURER_NUMBER_SYSTEM, "value" => record.insurer_number },
            "display" => record.insurer_name.presence
          }.compact
        else
          { "display" => record.insurer_name.presence || "保険者不明" }
        end
      end

      # 請求セット。同じ保険が複数のセットに属することがあるので配列で持つ。
      def class_entries(sets)
        Array(sets).map do |set|
          {
            "type" => { "coding" => [{ "system" => ReceiptComputer::COVERAGE_CLASS_SYSTEM,
                                       "code" => ReceiptComputer::BILLING_SET_CODE }] },
            "value" => set.key,
            "name" => set.label.presence
          }.compact
        end
      end

      def cost_of(record)
        return nil if record.copay_percent.blank?

        [{
          "type" => { "coding" => [{ "system" => COPAY_TYPE_SYSTEM, "code" => "copaypct" }] },
          "valueQuantity" => {
            "value" => record.copay_percent,
            "unit" => "%",
            "system" => "http://unitsofmeasure.org",
            "code" => "%"
          }
        }]
      end

      def extensions(record)
        [
          value_string(INSURED_SYMBOL_EXT, record.symbol),
          value_string(INSURED_NUMBER_EXT, record.number),
          value_string(INSURED_SUBNUMBER_EXT, record.branch)
        ].compact
      end

      def value_string(url, value)
        return nil if value.blank?

        { "url" => url, "valueString" => value }
      end
    end
  end
end
