# 入外区分(入院 / 外来)。オーダーヘッダ(ServiceRequest)と報告(DiagnosticReport)の category に、
# Encounter.class と同じ HL7 v3 ActCode の IMP / AMB で入っている。
# frontend の fhir/shared.ts(careSettingOf / careSettingCoding)と同じ対応。
module CareSetting
  SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode".freeze
  INPATIENT = "inpatient".freeze
  OUTPATIENT = "outpatient".freeze
  CODES = { INPATIENT => "IMP", OUTPATIENT => "AMB" }.freeze
  LABELS = { INPATIENT => "入院", OUTPATIENT => "外来" }.freeze

  module_function

  # リソースの入外区分("inpatient" / "outpatient")。持たなければ nil。
  def of(resource)
    concepts = resource&.dig("category")
    concepts = [concepts] if concepts.is_a?(Hash)
    Array(concepts).each do |concept|
      Array(concept["coding"]).each do |coding|
        setting = CODES.key(coding["code"]) if coding["system"] == SYSTEM
        return setting if setting
      end
    end
    nil
  end

  # 「入院」「外来」。持たなければ空文字。
  def label(resource)
    LABELS.fetch(of(resource), "")
  end

  def inpatient?(resource)
    of(resource) == INPATIENT
  end

  # category の 1 要素。
  def category(setting)
    { "coding" => [{ "system" => SYSTEM, "code" => CODES.fetch(setting) }] }
  end
end
