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

  def ssmix2_enable!
    FacilitySettings.current.update!(ssmix2: { "enabled" => true, "root_path" => "/ssmix2", "facility_id" => "2219999998",
                                               "patient_id_digits" => 6, "sending_application" => "HIS123" })
    Ssmix2::Settings.reset_cache!
  end

  def segments_of(result) = result.hl7.split("\r")

  def segment(result, name) = segments_of(result).find { |s| s.start_with?("#{name}|") }

  def segments(result, name) = segments_of(result).select { |s| s.start_with?("#{name}|") }
end

RSpec.configure do |config|
  config.include Ssmix2Helpers
end
