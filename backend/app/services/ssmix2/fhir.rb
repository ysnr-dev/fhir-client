module Ssmix2
  # FHIR リソース(Hash)の読み出し。frontend の fhir/*Helpers.ts と同じ約束(identifier の体系、
  # 氏名の表記区分、診療科コードの置き場)をこちらでも持つ。
  module Fhir
    PATIENT_IDENTIFIER_SYSTEM = "urn:oid:1.2.392.100495.20.3.51".freeze
    REPRESENTATION_URL = "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation".freeze
    DEPARTMENT_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/ssmix2-department-code".freeze
    INSTITUTION_NO_SYSTEM = "http://jpfhir.jp/fhir/core/IdSystem/insurance-medical-institution-no".freeze
    MEDICAL_REGISTRATION_NUMBER_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/medicalRegistrationNumber".freeze
    PHYSICAL_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/location-physical-type".freeze
    ACT_CODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode".freeze
    PARTICIPATION_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ParticipationType".freeze
    # オーダー(frontend/src/fhir/orderHeader.ts・prescriptionHelpers.ts・injectionHelpers.ts・labOrderHelpers.ts)。
    ORDER_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/order-type".freeze
    ORDER_DEPARTMENT_EXT_URL = "http://fhir-client.local/StructureDefinition/order-department".freeze
    PRESCRIPTION_SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-setting".freeze
    PRESCRIPTION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-category".freeze
    INJECTION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/injection-category".freeze
    MEDICINE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-code".freeze
    YJ_CODE_SYSTEM = "http://capstandard.jp/iyaku.info/CodeSystem/YJ-code".freeze
    GENERAL_ORDER_CODE_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationGeneralOrderCode".freeze
    USAGE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage".freeze
    USAGE_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage-basic-category".freeze
    RP_NUMBER_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber".freeze
    ORDER_IN_RP_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/MedicationAdministrationIndex".freeze
    ROUTE_SYSTEM = "http://jpfhir.jp/fhir/core/CodeSystem/route-codes".freeze
    SCHEDULED_PERIOD_EXT_URL = "http://fhir-client.local/StructureDefinition/injection-scheduled-period".freeze
    LINE_EXT_URL = "http://fhir-client.local/StructureDefinition/injection-line".freeze
    # 検体検査(labOrderHelpers.ts・labResultHelpers.ts)。
    LAB_ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/lab-order-item".freeze
    RESULT_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-item".freeze
    JLAC10_SYSTEM = "http://fhir-client.local/CodeSystem/jlac10".freeze
    JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11".freeze
    JLAC11_SPECIMEN_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11-specimen".freeze
    ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation".freeze
    LAB_RESULT_SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-setting".freeze
    INTERPRETATION_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation".freeze
    UCUM_SYSTEM = "http://unitsofmeasure.org".freeze
    # 病名(conditionHelpers.ts)。
    DISEASE_KEY_NUMBER_SYSTEM = "http://medis.or.jp/CodeSystem/master-disease-keyNumber".freeze
    DISEASE_EXCHANGE_SYSTEM = "http://medis.or.jp/CodeSystem/master-disease-exCode".freeze
    ICD10_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/ICD10-2013-full".freeze
    MODIFIER_KEY_NUMBER_SYSTEM = "http://medis.or.jp/CodeSystem/master-disease-modKeyNumber".freeze
    MODIFIER_EXCHANGE_SYSTEM = "http://medis.or.jp/CodeSystem/master-disease-modExCode".freeze
    PREFIX_MODIFIER_EXT_URL = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Condition_DiseasePrefixModifier".freeze
    POSTFIX_MODIFIER_EXT_URL = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Condition_DiseasePostfixModifier".freeze
    CONDITION_LOCAL_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/condition-category".freeze
    NURSING_PROBLEM_CODE = "nursing-problem".freeze
    SUSPECTED_MODIFIER_NUMBER = "27000001".freeze
    # アレルギー(allergyHelpers.ts)。J-FAGY の医薬品コードは Y + YJ コード。
    JFAGY_YCM_PREFIX = "Y".freeze
    # 外来受付(appointmentHelpers.ts)。
    APPOINTMENT_CHECKED_IN_AT_EXT_URL = "http://fhir-client.local/StructureDefinition/appointment-checked-in-at".freeze

    Name = Struct.new(:family_kanji, :given_kanji, :family_kana, :given_kana, keyword_init: true)

    module_function

    # "Patient/123" / "urn:uuid:…" / 絶対 URL から種別と id を取る。
    def split_reference(reference)
      text = reference.to_s
      return [nil, nil] if text.empty? || text.start_with?("urn:")

      parts = text.split("/")
      history = parts.index("_history")
      parts = parts[0...history] if history
      return [nil, nil] if parts.size < 2

      [parts[-2], parts[-1]]
    end

    def reference_id(reference) = split_reference(reference)[1]

    def reference_of(resource) = "#{resource['resourceType']}/#{resource['id']}"

    def identifier_value(resource, system)
      Array(resource&.dig("identifier")).find { |i| i["system"] == system }&.dig("value")
    end

    # 患者番号。体系の指定が無い identifier(他システム由来)も患者番号として扱う。
    def patient_number(patient)
      identifiers = Array(patient&.dig("identifier"))
      found = identifiers.find { |i| i["system"] == PATIENT_IDENTIFIER_SYSTEM } ||
              identifiers.find { |i| i["system"].blank? }
      found&.dig("value").presence
    end

    # 氏名。表記の指定が無い name は漢字として扱う(他システム由来)。
    def name(resource)
      names = Array(resource&.dig("name"))
      kanji = names.find { |n| representation(n) == "IDE" } || names.find { |n| representation(n).nil? } || names.first
      kana = names.find { |n| representation(n) == "SYL" }
      Name.new(
        family_kanji: kanji&.dig("family").to_s, given_kanji: Array(kanji&.dig("given")).first.to_s,
        family_kana: kana&.dig("family").to_s, given_kana: Array(kana&.dig("given")).first.to_s
      )
    end

    def representation(human_name)
      Array(human_name["extension"]).find { |e| e["url"] == REPRESENTATION_URL }&.dig("valueCode")
    end

    def coding(codeable, system)
      Array(codeable&.dig("coding")).find { |c| c["system"] == system }
    end

    def first_coding(codeable) = Array(codeable&.dig("coding")).first

    # 診療科(Organization)の SS-MIX2 統一診療科コード。無ければ nil。
    def department_code(organization) = identifier_value(organization, DEPARTMENT_CODE_SYSTEM).presence

    def physical_type(location)
      coding(location&.dig("physicalType"), PHYSICAL_TYPE_SYSTEM)&.dig("code")
    end

    def participant_reference(encounter, type_code)
      Array(encounter&.dig("participant")).find do |p|
        Array(p["type"]).any? { |t| coding(t, PARTICIPATION_TYPE_SYSTEM)&.dig("code") == type_code }
      end&.dig("individual", "reference")
    end

    def phone(resource, use)
      Array(resource&.dig("telecom")).find do |t|
        t["system"] == "phone" && (use == "home" ? t["use"] != "mobile" && t["use"] != "work" : t["use"] == use)
      end&.dig("value").presence
    end

    def extension(resource, url)
      Array(resource&.dig("extension")).find { |e| e["url"] == url }
    end

    # category の中から system のコードを取る。
    def category_code(resource, system)
      Array(resource&.dig("category")).each do |concept|
        found = coding(concept, system)
        return found["code"] if found
      end
      nil
    end

    def order_type(service_request) = category_code(service_request, ORDER_TYPE_SYSTEM)

    def department_reference(resource) = extension(resource, ORDER_DEPARTMENT_EXT_URL)&.dig("valueReference", "reference")

    def status_code(codeable) = first_coding(codeable)&.dig("code")

    def display_of(codeable)
      codeable&.dig("text").presence || first_coding(codeable)&.dig("display")
    end

    def address_text(address)
      return nil if address.nil?

      address["text"].presence ||
        [address["state"], address["city"], *Array(address["line"])].compact.join.presence
    end
  end
end
