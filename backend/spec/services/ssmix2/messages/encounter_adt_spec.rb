require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::EncounterAdt do
  let(:resources) do
    { "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department,
      "Organization/dept2" => ssmix2_department(id: "dept2", code: "10", name: "外科"),
      "Location/bed1" => ssmix2_location("bed1", "1", "bd", part_of: "room1"),
      "Location/room1" => ssmix2_location("room1", "302", "ro", part_of: "ward1"),
      "Location/ward1" => ssmix2_location("ward1", "32", "wa"),
      "Location/bed2" => ssmix2_location("bed2", "2", "bd", part_of: "room2"),
      "Location/room2" => ssmix2_location("room2", "305", "ro", part_of: "ward1"),
      "Location/bed3" => ssmix2_location("bed3", "3", "bd", part_of: "room2") }
  end
  let(:store) { ssmix2_store(resources) }
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before { ssmix2_enable! }

  def build(encounter, method:, version: nil, previous: nil)
    allow(store).to receive(:read_or_nil).with("Encounter/#{encounter['id']}/_history", version - 1).and_return(previous) if version && version > 1
    transaction = ssmix2_transaction(method: method, path: "/Encounter/#{encounter['id']}", request: encounter, response: encounter)
    written = Ssmix2::Dispatcher::Written.new(method: method, type: "Encounter", id: encounter["id"], version: version, resource: encounter)
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  it "sends ADT^A01 for a new admission with the bed, ward, department and attending doctor" do
    result = build(ssmix2_admission, method: "POST", version: 1)

    expect(result.data_kind).to eq("ADT-22")
    expect(result.service_date).to eq("20261101")
    expect(result.process).to eq("INS")
    expect(result.order_no).to match(/\A\d{15}\z/)
    expect(result.department_code).to eq("01")
    expect(segment(result, "MSH")).to include("|ADT^A01^ADT_A01|")
    expect(segment(result, "EVN")).to eq("EVN||20261104103012|||220^医師^一郎^^^^^^^L^^^^^I||2219999998")
    pv1 = segment(result, "PV1").split("|")
    expect(pv1[2]).to eq("I")
    expect(pv1[3]).to eq("32^302^1^^^N")
    expect(pv1[7]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    expect(pv1[10]).to eq("01")
    expect(pv1[17]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    expect(pv1[44]).to eq("20261101160000")
  end

  it "sends ADT^A01 when a planned admission is carried out and nothing when a plan is marked entered-in-error" do
    planned = ssmix2_admission(status: "planned")
    result = build(ssmix2_admission, method: "PUT", version: 2, previous: planned)
    expect(result.data_kind).to eq("ADT-22")
    expect(segment(result, "MSH")).to include("|ADT^A01^ADT_A01|")

    allow(store).to receive(:read_or_nil).with("Encounter/enc2/_history", 1).and_return(planned.merge("id" => "enc2"))
    erroneous = ssmix2_admission(id: "enc2", status: "entered-in-error")
    transaction = ssmix2_transaction(method: "PUT", path: "/Encounter/enc2", request: erroneous, response: erroneous)
    written = Ssmix2::Dispatcher::Written.new(method: "PUT", type: "Encounter", id: "enc2", version: 2, resource: erroneous)
    expect(described_class.new(context: context, transaction: transaction, written: written).build).to be_nil
  end

  it "sends ADT^A03 when the encounter finishes, and ADT^A13 (DEL) when the discharge is undone" do
    admitted = ssmix2_admission
    discharged = ssmix2_admission(status: "finished", finish: "2026-11-04T10:00:00+09:00")

    result = build(discharged, method: "PUT", version: 3, previous: admitted)
    expect(result.data_kind).to eq("ADT-52")
    expect(result.service_date).to eq("20261104")
    expect(result.process).to eq("INS")
    expect(segment(result, "MSH")).to include("|ADT^A03^ADT_A03|")
    expect(segment(result, "PV1").split("|")[45]).to eq("20261104100000")
    a03_order = result.order_no

    undone = build(admitted, method: "PUT", version: 4, previous: discharged)
    expect(undone.data_kind).to eq("ADT-52")
    expect(undone.process).to eq("DEL")
    expect(undone.order_no).to eq(a03_order)
    expect(segment(undone, "MSH")).to include("|ADT^A13^ADT_A01|")
  end

  it "sends ADT^A02 with the previous location when the bed changes" do
    before_move = ssmix2_admission
    moved = ssmix2_admission(bed: "bed2")
    moved["location"] << { "location" => { "reference" => "Location/bed1" }, "status" => "completed" }
    moved["location"][0]["period"] = { "start" => "2026-11-03T14:00:00+09:00" }

    result = build(moved, method: "PUT", version: 2, previous: before_move)

    expect(result.data_kind).to eq("ADT-42")
    expect(result.service_date).to eq("20261103")
    expect(segment(result, "EVN").split("|")[6]).to eq("20261103140000")
    pv1 = segment(result, "PV1").split("|")
    expect(pv1[3]).to eq("32^305^2^^^N")
    expect(pv1[6]).to eq("32^302^1^^^N")
  end

  it "sends ADT^A12 (DEL) with the A02's order number when the last move is undone, and restores the department" do
    before_move = ssmix2_admission
    moved = ssmix2_admission(bed: "bed2", department: "dept2")
    moved["location"][0]["period"] = { "start" => "2026-11-03" }
    moved["location"] << { "location" => { "reference" => "Location/bed1" }, "status" => "completed",
                           "period" => { "end" => "2026-11-03" } }
    a02 = build(moved, method: "PUT", version: 2, previous: before_move)
    expect(segment(a02, "MSH")).to include("|ADT^A02^ADT_A02|")

    undone = build(before_move, method: "PUT", version: 3, previous: moved)

    expect(undone.data_kind).to eq("ADT-42")
    expect(undone.process).to eq("DEL")
    expect(undone.service_date).to eq("20261103")
    expect(undone.order_no).to eq(a02.order_no)
    expect(undone.department_code).to eq("01")
    expect(segment(undone, "MSH")).to include("|ADT^A12^ADT_A09|")
    expect(segment(undone, "EVN").split("|")[6]).to eq("20261103")
    pv1 = segment(undone, "PV1").split("|")
    expect(pv1[3]).to eq("32^302^1^^^N")
    expect(pv1[6]).to eq("32^305^2^^^N")
    expect(pv1[10]).to eq("01")
  end

  it "gives a new move to another bed after an undo its own order number" do
    before_move = ssmix2_admission
    to_bed2 = ssmix2_admission(bed: "bed2")
    to_bed2["location"][0]["period"] = { "start" => "2026-11-03" }
    to_bed2["location"] << { "location" => { "reference" => "Location/bed1" }, "status" => "completed" }
    to_bed3 = ssmix2_admission(bed: "bed3")
    to_bed3["location"][0]["period"] = { "start" => "2026-11-03" }
    to_bed3["location"] << { "location" => { "reference" => "Location/bed1" }, "status" => "completed" }

    first = build(to_bed2, method: "PUT", version: 2, previous: before_move)
    again = build(to_bed3, method: "PUT", version: 4, previous: before_move)

    expect(again.order_no).not_to eq(first.order_no)
  end

  it "sends ADT^A11 (DEL) for an admission entered in error and the same order number as the A01" do
    admitted = ssmix2_admission
    a01 = build(admitted, method: "POST", version: 1)
    cancelled = build(ssmix2_admission(status: "entered-in-error"), method: "PUT", version: 2, previous: admitted)

    expect(cancelled.data_kind).to eq("ADT-22")
    expect(cancelled.process).to eq("DEL")
    expect(cancelled.order_no).to eq(a01.order_no)
    expect(segment(cancelled, "MSH")).to include("|ADT^A11^ADT_A09|")
  end

  it "ignores updates that are not an event, and encounters that are not admissions" do
    admitted = ssmix2_admission
    edited = ssmix2_admission.merge("extension" => [{ "url" => "x", "valueString" => "note" }])
    expect(build(edited, method: "PUT", version: 2, previous: admitted)).to be_nil

    outpatient = ssmix2_admission.merge("class" => { "code" => "AMB" })
    expect(build(outpatient, method: "POST", version: 1)).to be_nil
  end
end
