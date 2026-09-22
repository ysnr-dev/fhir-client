# 会計送信の spec で使う FHIR リソースの雛形と、上流の読み取りを差し替えるフェイク。
#
# 上流の検索は _revinclude で他のリソース種別が混ざって返るので、フェイクも
# 「主の種別 + _revinclude で指した種別」をまとめて返す。条件による絞り込みは
# しない(組み立ての正しさだけを見るため)。
module BillingFhirFixtures
  ORDER_TYPE = "http://fhir-client.local/CodeSystem/order-type".freeze
  MEDICINE_CODE = "http://fhir-client.local/CodeSystem/medicine-code".freeze
  MEDICAL_MATERIAL = "http://fhir-client.local/CodeSystem/medical-material".freeze
  RAD_MATERIAL = "http://fhir-client.local/CodeSystem/rad-material".freeze

  class FakeStore
    attr_reader :resources, :searches

    def initialize
      @resources = Hash.new { |h, k| h[k] = [] }
      @searches = []
    end

    def add(*list)
      list.flatten.each { |r| @resources[r["resourceType"]] << r }
      self
    end

    def search(type, params, **)
      @searches << [type, params]
      included = params.to_a.select { |k, _| k.to_s.start_with?("_revinclude") }
                       .map { |_, v| v.to_s.split(":").first }
      ([type] + included).uniq.flat_map { |t| @resources[t] }
    end

    def read(type, id)
      @resources[type].find { |r| r["id"] == id } or raise Integrations::FhirStore::NotFound, "#{type}/#{id}"
    end

    def read_or_nil(type, id) = @resources[type].find { |r| r["id"] == id }
  end

  # 処方のヘッダは order-type を持たない(それで処方と判定する規約)。
  def order_header(order_type:, id: "hdr-1", date: "2026-09-20", status: "active", name: nil)
    category = if order_type == "prescription"
                 [{ "coding" => [{ "system" => "#{ORDER_TYPE.sub('order-type', 'prescription-setting')}",
                                   "code" => "outpatient" }] }]
               else
                 [{ "coding" => [{ "system" => ORDER_TYPE, "code" => order_type }] }]
               end
    {
      "resourceType" => "ServiceRequest", "id" => id, "status" => status,
      "authoredOn" => "#{date}T09:00:00+09:00", "occurrenceDateTime" => "#{date}T10:00:00+09:00",
      "category" => category,
      "code" => { "text" => name || "#{order_type}伝票" }
    }
  end

  def order_detail(item_code:, system:, parent: "hdr-1", name: "項目", id: nil, date: "2026-09-20")
    {
      "resourceType" => "ServiceRequest", "id" => id || "d-#{item_code}", "status" => "active",
      "authoredOn" => "#{date}T09:00:00+09:00",
      "code" => { "text" => name, "coding" => [{ "system" => system, "code" => item_code }] },
      "basedOn" => [{ "reference" => "ServiceRequest/#{parent}" }]
    }
  end

  # 実施記録のハブ。code_system は種別ごとの手技コード体系。
  def procedure_hub(order_type:, code:, id: "proc-1", order: "hdr-1", date: "2026-09-20", time: "10:30",
                    name: "手技", status: "completed", materials: [], note: nil, period_end: nil)
    hub = {
      "resourceType" => "Procedure", "id" => id, "status" => status,
      "category" => { "coding" => [{ "system" => ORDER_TYPE, "code" => order_type }] },
      "subject" => { "reference" => "Patient/pat-1" },
      "basedOn" => [{ "reference" => "ServiceRequest/#{order}" }]
    }
    if period_end
      hub["performedPeriod"] = { "start" => "#{date}T#{time}:00+09:00", "end" => period_end }
    else
      hub["performedDateTime"] = "#{date}T#{time}:00+09:00"
    end
    if code
      hub["code"] = { "coding" => [{ "system" => "http://fhir-client.local/CodeSystem/#{order_type}-procedure-code",
                                     "code" => code, "display" => name }], "text" => name }
    end
    hub["usedCode"] = materials.map { |m| used_code(order_type, **m) } if materials.any?
    hub["note"] = [{ "text" => note }] if note
    hub
  end

  def child_procedure(order_type:, code:, hub: "proc-1", id: nil, name: "手技2", date: "2026-09-20")
    procedure_hub(order_type: order_type, code: code, id: id || "child-#{code}", date: date, name: name)
      .merge("partOf" => [{ "reference" => "Procedure/#{hub}" }])
  end

  def administration(code:, dose:, hub: "proc-1", id: nil, name: "薬剤", unit: "mL", system: MEDICINE_CODE,
                     route: nil, method: nil, request: nil)
    dosage = { "dose" => { "value" => dose, "unit" => unit } }
    dosage["route"] = { "coding" => [{ "system" => "http://jpfhir.jp/fhir/core/CodeSystem/route-codes", "code" => route }] } if route
    dosage["method"] = { "coding" => [{ "system" => "urn:oid:1.2.392.200250.2.2.20.40", "code" => method }] } if method
    {
      "resourceType" => "MedicationAdministration", "id" => id || "ma-#{code}", "status" => "completed",
      "medicationCodeableConcept" => { "coding" => [{ "system" => system, "code" => code, "display" => name }],
                                       "text" => name },
      "subject" => { "reference" => "Patient/pat-1" },
      "effectiveDateTime" => "2026-09-20T10:30:00+09:00",
      "partOf" => [{ "reference" => "Procedure/#{hub}" }],
      "request" => request ? { "reference" => "MedicationRequest/#{request}" } : nil,
      "dosage" => dosage
    }.compact
  end

  # 注射オーダーの薬剤。用法種別(点滴 / ワンショット)はここにしか無い。
  def injection_request(id:, code: "620007342", usage_type: nil, route: "IV", method: nil, parent: "hdr-1")
    instruction = {}
    instruction["route"] = { "coding" => [{ "system" => "http://jpfhir.jp/fhir/core/CodeSystem/route-codes", "code" => route }] } if route
    instruction["method"] = { "coding" => [{ "system" => "urn:oid:1.2.392.200250.2.2.20.40", "code" => method }] } if method
    if usage_type
      instruction["extension"] = [{
        "url" => "http://fhir-client.local/StructureDefinition/injection-usage-type",
        "valueCodeableConcept" => { "coding" => [{ "system" => "http://fhir-client.local/CodeSystem/injection-usage-type",
                                                   "code" => usage_type }] }
      }]
    end
    {
      "resourceType" => "MedicationRequest", "id" => id, "status" => "active",
      "medicationCodeableConcept" => { "coding" => [{ "system" => MEDICINE_CODE, "code" => code }], "text" => "注射薬" },
      "basedOn" => [{ "reference" => "ServiceRequest/#{parent}" }],
      "dosageInstruction" => [instruction]
    }
  end

  def used_code(order_type, code:, quantity: nil, name: "材料", system: MEDICAL_MATERIAL, unit: "個")
    concept = { "coding" => [{ "system" => system, "code" => code, "display" => name }], "text" => name }
    if quantity
      concept["extension"] = [{
        "url" => "http://fhir-client.local/StructureDefinition/#{order_type}-material-quantity",
        "valueQuantity" => { "value" => quantity, "unit" => unit }
      }]
    end
    concept
  end

  # 施設設定のレセプト電算コード。渡した項目だけを上書きする。
  def receipt_codes!(values)
    settings = FacilitySettings.current
    settings.apply_settings("receipt_codes" => values)
    settings.save!
  end

  def task(order:, status:, code: "rad-exam", id: nil)
    {
      "resourceType" => "Task", "id" => id || "task-#{order}", "status" => status,
      "code" => { "coding" => [{ "system" => "http://fhir-client.local/CodeSystem/task-code", "code" => code }] },
      "focus" => { "reference" => "ServiceRequest/#{order}" }
    }
  end

  def medical_procedure!(code, name:, chapter:, section: "000", **attrs)
    Master::MedicalProcedure.create!(procedure_code: code, name: name, code_table_number_alpha: chapter,
                                     code_table_section: section, **attrs)
  end
end

RSpec.configure do |config|
  config.include BillingFhirFixtures
end
