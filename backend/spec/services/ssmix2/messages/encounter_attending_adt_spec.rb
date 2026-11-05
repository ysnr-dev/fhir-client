require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::EncounterAttendingAdt do
  F = Ssmix2::Fhir unless defined?(F)
  let(:resources) do
    { "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department,
      "Practitioner/doc2" => ssmix2_doctor(id: "doc2").merge("name" => [{ "extension" => [{ "url" => F::REPRESENTATION_URL, "valueCode" => "IDE" }], "family" => "医師", "given" => ["二郎"] }],
                                                              "qualification" => [{ "identifier" => [{ "system" => F::MEDICAL_REGISTRATION_NUMBER_SYSTEM, "value" => "221" }] }]),
      "Location/bed1" => ssmix2_location("bed1", "1", "bd", part_of: "room1"),
      "Location/room1" => ssmix2_location("room1", "302", "ro", part_of: "ward1"),
      "Location/ward1" => ssmix2_location("ward1", "32", "wa") }
  end
  let(:store) { ssmix2_store(resources) }

  before { ssmix2_enable! }

  def build(encounter, method:, version:, previous: nil)
    allow(store).to receive(:read_or_nil).with("Encounter/enc1/_history", version - 1).and_return(previous) if version > 1
    context = Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new)
    transaction = ssmix2_transaction(method: method, path: "/Encounter/enc1", request: encounter, response: encounter)
    written = Ssmix2::Dispatcher::Written.new(method: method, type: "Encounter", id: "enc1", version: version, resource: encounter)
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  def with_attending(encounter, reference)
    participant = reference ? [{ "type" => [{ "coding" => [{ "system" => F::PARTICIPATION_TYPE_SYSTEM, "code" => "ATND" }] }], "individual" => { "reference" => reference } }] : []
    encounter.merge("participant" => participant)
  end

  it "sends ADT^A54 with the new attending doctor and ADT^A55 (DEL) when the attending is removed" do
    admitted = ssmix2_admission
    changed = with_attending(admitted, "Practitioner/doc2")

    result = build(changed, method: "PUT", version: 2, previous: admitted)
    expect(result.data_kind).to eq("ADT-01")
    expect(result.service_date).to eq("-")
    expect(result.process).to eq("INS")
    expect(segment(result, "MSH")).to include("|ADT^A54^ADT_A54|")
    expect(segment(result, "PV1").split("|")[7]).to eq("221^医師^二郎^^^^^^^L^^^^^I")

    removed = build(with_attending(admitted, nil), method: "PUT", version: 3, previous: changed)
    expect(removed.process).to eq("DEL")
    expect(removed.order_no).to eq(result.order_no)
    expect(segment(removed, "MSH")).to include("|ADT^A55^ADT_A52|")
    expect(segment(removed, "PV1").split("|")[7]).to eq("221^医師^二郎^^^^^^^L^^^^^I")
  end

  it "ignores admissions, unchanged attendings and plans" do
    admitted = ssmix2_admission
    expect(build(admitted, method: "POST", version: 1)).to be_nil
    expect(build(admitted, method: "PUT", version: 2, previous: admitted)).to be_nil
    planned = admitted.merge("status" => "planned")
    expect(build(admitted, method: "PUT", version: 2, previous: with_attending(planned, "Practitioner/doc2"))).to be_nil
  end
end
