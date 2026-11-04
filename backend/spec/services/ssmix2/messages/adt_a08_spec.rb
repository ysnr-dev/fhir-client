require "rails_helper"

RSpec.describe Ssmix2::Messages::AdtA08 do
  let(:patient) do
    {
      "resourceType" => "Patient", "id" => "p1",
      "meta" => { "lastUpdated" => "2026-11-04T10:30:12+09:00" },
      "identifier" => [{ "system" => Ssmix2::Fhir::PATIENT_IDENTIFIER_SYSTEM, "value" => "1234" }],
      "name" => [
        { "extension" => [{ "url" => Ssmix2::Fhir::REPRESENTATION_URL, "valueCode" => "IDE" }], "family" => "患者", "given" => ["太郎"] },
        { "extension" => [{ "url" => Ssmix2::Fhir::REPRESENTATION_URL, "valueCode" => "SYL" }], "family" => "カンジャ", "given" => ["タロウ"] }
      ],
      "gender" => "male", "birthDate" => "1948-04-05",
      "address" => [{ "postalCode" => "422-8033", "state" => "静岡県", "city" => "静岡市", "line" => ["登呂1-3-5"] }],
      "telecom" => [{ "system" => "phone", "value" => "054-000-0000", "use" => "home" }]
    }
  end
  let(:bed) { { "resourceType" => "Location", "id" => "bed1", "name" => "1", "physicalType" => { "coding" => [{ "system" => Ssmix2::Fhir::PHYSICAL_TYPE_SYSTEM, "code" => "bd" }] }, "partOf" => { "reference" => "Location/room1" } } }
  let(:room) { { "resourceType" => "Location", "id" => "room1", "name" => "302", "physicalType" => { "coding" => [{ "system" => Ssmix2::Fhir::PHYSICAL_TYPE_SYSTEM, "code" => "ro" }] }, "partOf" => { "reference" => "Location/ward1" } } }
  let(:ward) { { "resourceType" => "Location", "id" => "ward1", "name" => "32", "physicalType" => { "coding" => [{ "system" => Ssmix2::Fhir::PHYSICAL_TYPE_SYSTEM, "code" => "wa" }] } } }
  let(:doctor) do
    { "resourceType" => "Practitioner", "id" => "doc1",
      "name" => [{ "extension" => [{ "url" => Ssmix2::Fhir::REPRESENTATION_URL, "valueCode" => "IDE" }], "family" => "医師", "given" => ["一郎"] }],
      "qualification" => [{ "identifier" => [{ "system" => Ssmix2::Fhir::MEDICAL_REGISTRATION_NUMBER_SYSTEM, "value" => "220" }] }] }
  end
  let(:admission) do
    { "resourceType" => "Encounter", "id" => "enc1", "status" => "in-progress", "class" => { "code" => "IMP" },
      "location" => [{ "location" => { "reference" => "Location/bed1" } }],
      "participant" => [{ "type" => [{ "coding" => [{ "system" => Ssmix2::Fhir::PARTICIPATION_TYPE_SYSTEM, "code" => "ATND" }] }],
                          "individual" => { "reference" => "Practitioner/doc1" } }],
      "period" => { "start" => "2026-11-01T16:00:00+09:00" } }
  end
  let(:store) { instance_double(Integrations::FhirStore) }
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }
  let(:transaction) do
    Ssmix2Transaction.new(id: 7, occurred_at: Time.zone.parse("2026-11-04T01:30:12.345Z"), method: "PUT",
                          path: "/Patient/p1", request: patient, actor_practitioner_id: "doc1")
  end
  let(:written) { Ssmix2::Dispatcher::Written.new(method: "PUT", type: "Patient", id: "p1", version: 2, resource: patient) }

  before do
    FacilitySettings.current.update!(ssmix2: { "enabled" => true, "root_path" => "/ssmix2", "facility_id" => "2219999998",
                                               "patient_id_digits" => 6, "sending_application" => "HIS123" })
    Ssmix2::Settings.reset_cache!
    resources = { %w[Location bed1] => bed, %w[Location room1] => room, %w[Location ward1] => ward, %w[Practitioner doc1] => doctor }
    allow(store).to receive(:read_or_nil) { |type, id| resources[[type, id]] }
  end

  it "builds MSH / EVN / PID / PV1 for an inpatient" do
    allow(store).to receive(:search).with("Encounter", hash_including("patient" => "Patient/p1"), limit: 1).and_return([admission])

    result = described_class.new(context: context, transaction: transaction, written: written).build
    segments = result.hl7.split("\r")

    expect(result.data_kind).to eq("ADT-00")
    expect(result.service_date).to eq("-")
    expect(result.order_no).to eq("ALL9")
    expect(result.process).to eq("INS")
    expect(segments[0]).to eq(
      "MSH|^~\\&|HIS123|2219999998|GW||20261104103012.345||ADT^A08^ADT_A01|7001|P|2.5||||||~ISO IR87||ISO 2022-1994|" \
      "SS-MIX2_1.20_j^SS-MIX2^1.2.392.200250.2.1.100.1.2.120^ISO"
    )
    expect(segments[1]).to eq("EVN||20261104103012|||220^医師^一郎^^^^^^^L^^^^^I||2219999998")
    expect(segments[2]).to eq(
      "PID|0001||001234^^^^PI||患者^太郎^^^^^L^I~カンジャ^タロウ^^^^^L^P||19480405|M|||^^^^422-8033^JPN^H^静岡県静岡市登呂1-3-5||" \
      "^PRN^PH^^^^^^^^^054-000-0000||||||||||||||||||||20261104103012"
    )
    expect(segments[3]).to eq("PV1|0001|I|32^302^1^^^N||||220^医師^一郎^^^^^^^L^^^^^I#{"|" * 37}20261101160000")
    expect(result.hl7).to end_with("\r")
    expect(result.warnings).to be_empty
  end

  it "marks an outpatient as O and uses the FHIR id when the patient has no number" do
    allow(store).to receive(:search).and_return([])
    patient.delete("identifier")

    result = described_class.new(context: context, transaction: transaction, written: written).build
    segments = result.hl7.split("\r")

    expect(segments[2]).to start_with("PID|0001||0000p1^^^^PI|")
    expect(segments[3]).to eq("PV1|0001|O")
    expect(result.warnings).to include(a_string_matching(/患者番号が無い/))
  end
end
