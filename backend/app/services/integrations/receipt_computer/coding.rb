module Integrations
  module ReceiptComputer
    # FHIR リソースから特定の CodeSystem のコードを取り出す小物。
    # フロントの codingBySystem / categoryCoding と同じことを Ruby 側で行う。
    #
    # ここに並ぶのはカルテが焼き込んでいる体系だけで、レセコン側の体系は含まない。
    # レセプト電算コードは全国共通なので、連携先が変わっても同じものを使う。
    module Coding
      LOCAL = "http://fhir-client.local".freeze

      DISEASE_RECEIPT = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/masterB-disease".freeze
      MODIFIER_RECEIPT = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/masterZ-disease-modifier".freeze
      PREFIX_MODIFIER_EXT = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Condition_DiseasePrefixModifier".freeze
      POSTFIX_MODIFIER_EXT = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Condition_DiseasePostfixModifier".freeze

      MEDICINE_CODE = "#{LOCAL}/CodeSystem/medicine-code".freeze
      GENERAL_ORDER_CODE = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationGeneralOrderCode".freeze
      USAGE_CODE = "#{LOCAL}/CodeSystem/medicine-usage".freeze
      USAGE_CATEGORY = "#{LOCAL}/CodeSystem/medicine-usage-basic-category".freeze
      # 処方区分。外来は external(院外)/ internal(院内)。brought(持参)は請求しない。
      PRESCRIPTION_CATEGORY = "#{LOCAL}/CodeSystem/prescription-category".freeze

      ORDER_TYPE = "#{LOCAL}/CodeSystem/order-type".freeze
      SSMIX2_DEPARTMENT = "#{LOCAL}/CodeSystem/ssmix2-department-code".freeze
      TASK_CODE = "#{LOCAL}/CodeSystem/task-code".freeze

      # 実施記録の材料。特定保険医療材料(レセ電算の特定器材コード)をそのまま指すか、
      # 放射線だけ施設内の器材マスタ(受け側で特定器材コードに読み替える)を指す。
      MEDICAL_MATERIAL = "#{LOCAL}/CodeSystem/medical-material".freeze
      RAD_MATERIAL = "#{LOCAL}/CodeSystem/rad-material".freeze
      # 輸血製剤(施設の製剤マスタ。受け側で医薬品コードに読み替える)。
      TRANSFUSION_PRODUCT = "#{LOCAL}/CodeSystem/transfusion-product".freeze

      # 注射の投与経路(JP Core route-codes)と手技(JAMI 詳細用法コードの注射手技 30〜3Z)、
      # 用法種別(点滴 / ワンショット。ローカル拡張)。
      ROUTE = "http://jpfhir.jp/fhir/core/CodeSystem/route-codes".freeze
      METHOD = "urn:oid:1.2.392.200250.2.2.20.40".freeze
      INJECTION_USAGE_TYPE_EXT = "#{LOCAL}/StructureDefinition/injection-usage-type".freeze
      INJECTION_USAGE_TYPE = "#{LOCAL}/CodeSystem/injection-usage-type".freeze

      RP_GROUP_NUMBER = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber".freeze

      module_function

      # CodeableConcept から system 指定の coding を引く。
      def find(concept, system)
        Array(concept&.dig("coding")).find { |c| c["system"] == system }
      end

      def code_of(concept, system)
        find(concept, system)&.dig("code").presence
      end

      # category のような CodeableConcept の配列から引く。Procedure.category のように
      # 単数のところも同じ呼び方で済ませる。
      def code_in_list(concepts, system)
        list = concepts.is_a?(Hash) ? [concepts] : Array(concepts)
        list.each do |concept|
          code = code_of(concept, system)
          return code if code
        end
        nil
      end

      def display_of(concept, system)
        find(concept, system)&.dig("display").presence
      end

      # 表示名。text が無ければ指定 system の display。
      def label_of(concept, system)
        concept&.dig("text").presence || display_of(concept, system) || ""
      end

      # 参照("ServiceRequest/xx")の id 部分。
      def reference_id(reference)
        reference.to_s.split("/").last.presence
      end
    end
  end
end
