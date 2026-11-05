require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::EncounterPlanAdt do
  F = Ssmix2::Fhir unless defined?(F)
  let(:resources) do
    { "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department,
      "Organization/dept2" => ssmix2_department(id: "dept2", code: "02", name: "外科"),
      "Location/bed1" => ssmix2_location("bed1", "1", "bd", part_of: "room1"),
      "Location/room1" => ssmix2_location("room1", "302", "ro", part_of: "ward1"),
      "Location/ward1" => ssmix2_location("ward1", "32", "wa"),
      "Location/ward2" => ssmix2_location("ward2", "41", "wa") }
  end
  let(:store) { ssmix2_store(resources) }
  let(:planned) do
    { "resourceType" => "Encounter", "id" => "enc1", "status" => "planned", "class" => { "code" => "IMP" },
      "subject" => { "reference" => "Patient/p1" }, "period" => { "start" => "2026-11-10" },
      "location" => [{ "location" => { "reference" => "Location/ward1" }, "status" => "planned", "physicalType" => { "coding" => [{ "system" => F::PHYSICAL_TYPE_SYSTEM, "code" => "wa" }] } },
                     { "location" => { "reference" => "Location/room1" }, "status" => "planned", "physicalType" => { "coding" => [{ "system" => F::PHYSICAL_TYPE_SYSTEM, "code" => "ro" }] } }],
      "participant" => [{ "type" => [{ "coding" => [{ "system" => F::PARTICIPATION_TYPE_SYSTEM, "code" => "ATND" }] }], "individual" => { "reference" => "Practitioner/doc1" } }],
      "serviceProvider" => { "reference" => "Organization/dept1" } }
  end

  before { ssmix2_enable! }

  def build(encounter, method:, version: nil, previous: nil)
    allow(store).to receive(:read_or_nil).with("Encounter/enc1/_history", version - 1).and_return(previous) if version && version > 1
    context = Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new)
    transaction = ssmix2_transaction(method: method, path: "/Encounter/enc1", request: encounter, response: encounter)
    written = Ssmix2::Dispatcher::Written.new(method: method, type: "Encounter", id: "enc1", version: version, resource: encounter)
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  it "sends ADT^A14 for a planned admission and ADT^A27 (DEL) when the plan is cancelled" do
    result = build(planned, method: "POST", version: 1)

    expect(result.data_kind).to eq("ADT-21")
    expect(result.service_date).to eq("20261110")
    expect(result.process).to eq("INS")
    expect(segment(result, "MSH")).to include("|ADT^A14^ADT_A05|")
    pv1 = segment(result, "PV1").split("|")
    expect(pv1[2..3]).to eq(%w[I 32^302^^^^N])
    expect(pv1[7]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    expect(pv1[10]).to eq("01")
    expect(pv1[44]).to be_nil
    expect(segment(result, "PV2").split("|")[8]).to eq("20261110")

    cancelled = build(planned.merge("status" => "cancelled"), method: "PUT", version: 2, previous: planned)
    expect(cancelled.data_kind).to eq("ADT-21")
    expect(cancelled.process).to eq("DEL")
    expect(cancelled.order_no).to eq(result.order_no)
    expect(segment(cancelled, "MSH")).to include("|ADT^A27^ADT_A21|")
    expect(segment(cancelled, "PV2").split("|")[1]).to eq("32^302^^^^N")
    expect(segment(cancelled, "PV2").split("|")[8]).to eq("20261110")
  end

  it "stays silent when the plan is carried out (planned → in-progress) and for an undated plan uses '-'" do
    expect(build(ssmix2_admission, method: "PUT", version: 2, previous: planned)).to be_nil

    undated = build(planned.except("period"), method: "POST", version: 1)
    expect(undated.service_date).to eq("-")
    expect(segment(undated, "PV2")).to be_nil
  end

  it "sends ADT^A16 when a discharge plan is set, ADT^A25 (DEL) when it is removed, and nothing when the discharge happens" do
    admitted = ssmix2_admission
    plan = { "url" => F::DISCHARGE_PLAN_EXT_URL, "extension" => [{ "url" => "date", "valueDateTime" => "2026-11-12T10:00:00+09:00" }, { "url" => "reason", "valueString" => "軽快" }] }
    with_plan = admitted.merge("extension" => [plan])

    result = build(with_plan, method: "PUT", version: 2, previous: admitted)
    expect(result.data_kind).to eq("ADT-51")
    expect(result.service_date).to eq("20261112")
    expect(segment(result, "MSH")).to include("|ADT^A16^ADT_A16|")
    expect(segment(result, "PV2").split("|")[9]).to eq("20261112100000")

    removed = build(admitted, method: "PUT", version: 3, previous: with_plan)
    expect(removed.process).to eq("DEL")
    expect(removed.order_no).to eq(result.order_no)
    expect(segment(removed, "MSH")).to include("|ADT^A25^ADT_A21|")
    expect(segment(removed, "PV2").split("|")[9]).to eq("20261112100000")

    discharged = ssmix2_admission(status: "finished", finish: "2026-11-12T10:00:00+09:00")
    expect(build(discharged, method: "PUT", version: 3, previous: with_plan)).to be_nil
  end

  it "sends ADT^A15 for a transfer plan with the destination department, ADT^A26 when dropped, nothing when executed" do
    admitted = ssmix2_admission
    plan = { "url" => F::TRANSFER_PLAN_EXT_URL, "extension" => [{ "url" => "date", "valueDate" => "2026-11-09" },
                                                                 { "url" => "ward", "valueReference" => { "reference" => "Location/ward2" } },
                                                                 { "url" => "department", "valueReference" => { "reference" => "Organization/dept2" } }] }
    with_plan = admitted.merge("extension" => [plan])

    result = build(with_plan, method: "PUT", version: 2, previous: admitted)
    expect(result.data_kind).to eq("ADT-41")
    expect(result.service_date).to eq("20261109")
    expect(segment(result, "MSH")).to include("|ADT^A15^ADT_A15|")
    expect(segment(result, "PV1").split("|")[10]).to eq("02")
    expect(segment(result, "PV2").split("|")[8]).to eq("20261109")

    dropped = build(admitted, method: "PUT", version: 3, previous: with_plan)
    expect(segment(dropped, "MSH")).to include("|ADT^A26^ADT_A21|")
    expect(dropped.process).to eq("DEL")
    expect(segment(dropped, "PV2").split("|")[1]).to eq("41^^^^^N")

    moved = admitted.merge("location" => [{ "location" => { "reference" => "Location/bed1" } }, { "location" => { "reference" => "Location/bed1" } }],
                           "serviceProvider" => { "reference" => "Organization/dept2" })
    expect(build(moved, method: "PUT", version: 3, previous: with_plan)).to be_nil
  end
end
