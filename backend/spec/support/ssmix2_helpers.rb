# SS-MIX2 の builder spec で使う FHIR の fixture と、上流の代わりになる FhirStore の二重。
module Ssmix2Helpers
  F = Ssmix2::Fhir

  def ssmix2_patient(id: "p1", number: "1234")
    {
      "resourceType" => "Patient", "id" => id,
      "identifier" => [{ "system" => F::PATIENT_IDENTIFIER_SYSTEM, "value" => number }],
      "name" => [
        { "extension" => [{ "url" => F::REPRESENTATION_URL, "valueCode" => "IDE" }], "family" => "患者", "given" => ["太郎"] },
        { "extension" => [{ "url" => F::REPRESENTATION_URL, "valueCode" => "SYL" }], "family" => "カンジャ", "given" => ["タロウ"] }
      ],
      "gender" => "male", "birthDate" => "1948-04-05"
    }
  end

  def ssmix2_doctor(id: "doc1")
    { "resourceType" => "Practitioner", "id" => id,
      "name" => [{ "extension" => [{ "url" => F::REPRESENTATION_URL, "valueCode" => "IDE" }], "family" => "医師", "given" => ["一郎"] }],
      "qualification" => [{ "identifier" => [{ "system" => F::MEDICAL_REGISTRATION_NUMBER_SYSTEM, "value" => "220" }] }] }
  end

  def ssmix2_department(id: "dept1", code: "01", name: "内科")
    { "resourceType" => "Organization", "id" => id, "name" => name,
      "identifier" => [{ "system" => F::DEPARTMENT_CODE_SYSTEM, "value" => code }] }
  end

  def ssmix2_location(id, name, type, part_of: nil)
    location = { "resourceType" => "Location", "id" => id, "name" => name,
                 "physicalType" => { "coding" => [{ "system" => F::PHYSICAL_TYPE_SYSTEM, "code" => type }] } }
    location["partOf"] = { "reference" => "Location/#{part_of}" } if part_of
    location
  end

  def ssmix2_admission(id: "enc1", bed: "bed1", status: "in-progress", start: "2026-11-01T16:00:00+09:00", finish: nil, department: "dept1")
    encounter = { "resourceType" => "Encounter", "id" => id, "status" => status, "class" => { "code" => "IMP" },
                  "subject" => { "reference" => "Patient/p1" },
                  "location" => [{ "location" => { "reference" => "Location/#{bed}" }, "status" => "active" }],
                  "participant" => [{ "type" => [{ "coding" => [{ "system" => F::PARTICIPATION_TYPE_SYSTEM, "code" => "ATND" }] }],
                                      "individual" => { "reference" => "Practitioner/doc1" } }],
                  "serviceProvider" => { "reference" => "Organization/#{department}" },
                  "period" => { "start" => start } }
    encounter["period"]["end"] = finish if finish
    encounter
  end

  # FhirStore の代わり。resources は "Type/id" → リソース、searches は [type, 条件の一部] → 配列。
  def ssmix2_store(resources, searches: {})
    store = instance_double(Integrations::FhirStore)
    allow(store).to receive(:read_or_nil) { |type, id| resources["#{type}/#{id}"] }
    allow(store).to receive(:search) do |type, params, **|
      key = searches.keys.find { |t, subset| t == type && subset.all? { |k, v| params[k] == v } }
      key ? searches[key] : []
    end
    store
  end

  def ssmix2_transaction(method:, path:, request:, response: nil, actor: "doc1", id: 7)
    Ssmix2Transaction.new(id: id, occurred_at: Time.zone.parse("2026-11-04T01:30:12.345Z"), method: method,
                          path: path, request: request, response: response, actor_practitioner_id: actor)
  end

  def ssmix2_enable!(extended: false)
    FacilitySettings.current.update!(ssmix2: { "enabled" => true, "root_path" => "/ssmix2", "facility_id" => "2219999998",
                                               "extended_root_path" => extended ? "/ssmix2-ext" : "",
                                               "patient_id_digits" => 6, "sending_application" => "HIS123" })
    Ssmix2::Settings.reset_cache!
  end

  def ssmix2_institution(id: "org1")
    { "resourceType" => "Organization", "id" => id, "name" => "テスト病院",
      "identifier" => [{ "system" => F::INSTITUTION_NO_SYSTEM, "value" => "2219999998" }],
      "telecom" => [{ "system" => "phone", "value" => "054-000-1111", "use" => "work" }],
      "address" => [{ "postalCode" => "422-8033", "state" => "静岡県", "city" => "静岡市", "line" => ["登呂1-3-5"] }] }
  end

  XHTML = "http://www.w3.org/1999/xhtml".freeze

  def ssmix2_note_section(code, div, title: nil)
    section = { "code" => { "coding" => [{ "system" => "http://loinc.org", "code" => code }] },
                "text" => { "status" => "additional", "div" => "<div xmlns=\"#{XHTML}\">#{div}</div>" } }
    section["title"] = title if title
    section
  end

  # 診療記録(clinicalNoteHelpers.ts の buildClinicalNote と同じ形)。既定は対象プロブレム + S / O(画像入り)/ A の 3 セクション。
  def ssmix2_composition(id: "c1", status: "final", version: 1, type: "11506-3", nursing: false, sections: nil, department: "dept1",
                         date: "2026-11-04T10:30:00+09:00")
    composition = {
      "resourceType" => "Composition", "id" => id,
      "meta" => { "versionId" => version.to_s, "lastUpdated" => "2026-11-04T10:35:12+09:00" },
      "status" => status,
      "type" => { "coding" => [{ "system" => "http://loinc.org", "code" => type }] },
      "subject" => { "reference" => "Patient/p1" },
      "date" => date,
      "author" => [{ "reference" => "Practitioner/doc1", "display" => "医師 一郎" }],
      "title" => "診療記録",
      "attester" => [{ "mode" => "legal", "time" => "2026-11-04T10:35:00+09:00",
                       "party" => { "reference" => "Practitioner/doc1", "display" => "医師 一郎" } }],
      "section" => sections || [
        { "title" => "プロブレム", "code" => { "coding" => [{ "system" => "http://loinc.org", "code" => "11450-4" }] },
          "text" => { "status" => "generated", "div" => "<div xmlns=\"#{XHTML}\"><p>#1 高血圧症</p></div>" },
          "entry" => [{ "reference" => "Condition/cond1", "display" => "#1 高血圧症" }] },
        ssmix2_note_section("61150-9", "<p>頭痛が<strong>続く</strong></p>", title: "主観的情報(S)"),
        ssmix2_note_section("61149-1", "<p>BP 120/80</p><img src=\"data:image/png;base64,iVBORw0KGgo=\"/>", title: "客観的情報(O)"),
        ssmix2_note_section("51848-0", "<p>緊張型頭痛</p>", title: "評価(A)")
      ]
    }
    composition["category"] = [{ "coding" => [{ "system" => Ssmix2::Cda::ProgressNote::CLINICAL_NOTE_CATEGORY_SYSTEM, "code" => "nursing" }] }] if nursing
    composition["extension"] = [{ "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/#{department}", "display" => "内科" } }] if department
    composition
  end

  def segments_of(result) = result.hl7.split("\r")

  def segment(result, name) = segments_of(result).find { |s| s.start_with?("#{name}|") }

  def segments(result, name) = segments_of(result).select { |s| s.start_with?("#{name}|") }
end

RSpec.configure do |config|
  config.include Ssmix2Helpers
end
