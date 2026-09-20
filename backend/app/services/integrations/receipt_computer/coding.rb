module Integrations
  module ReceiptComputer
    # FHIR リソースから特定の CodeSystem のコードを取り出す小物。
    # フロントの codingBySystem / categoryCoding と同じことを Ruby 側で行う。
    #
    # ここに並ぶのはカルテが焼き込んでいる体系だけで、レセコン側の体系は含まない。
    # レセプト電算コードは全国共通なので、連携先が変わっても同じものを使う。
    module Coding
      DISEASE_RECEIPT = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/masterB-disease".freeze
      MODIFIER_RECEIPT = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/masterZ-disease-modifier".freeze
      PREFIX_MODIFIER_EXT = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Condition_DiseasePrefixModifier".freeze
      POSTFIX_MODIFIER_EXT = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Condition_DiseasePostfixModifier".freeze

      MEDICINE_CODE = "http://fhir-client.local/CodeSystem/medicine-code".freeze
      GENERAL_ORDER_CODE = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationGeneralOrderCode".freeze
      USAGE_CODE = "http://fhir-client.local/CodeSystem/medicine-usage".freeze
      USAGE_CATEGORY = "http://fhir-client.local/CodeSystem/medicine-usage-basic-category".freeze

      ORDER_TYPE = "http://fhir-client.local/CodeSystem/order-type".freeze
      SSMIX2_DEPARTMENT = "http://fhir-client.local/CodeSystem/ssmix2-department-code".freeze

      RP_GROUP_NUMBER = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber".freeze

      module_function

      # CodeableConcept から system 指定の coding を引く。
      def find(concept, system)
        Array(concept&.dig("coding")).find { |c| c["system"] == system }
      end

      def code_of(concept, system)
        find(concept, system)&.dig("code").presence
      end

      # category のような CodeableConcept の配列から引く。
      def code_in_list(concepts, system)
        Array(concepts).each do |concept|
          code = code_of(concept, system)
          return code if code
        end
        nil
      end

      def display_of(concept, system)
        find(concept, system)&.dig("display").presence
      end
    end
  end
end
