require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::EncounterLeaveAdt do
  F = Ssmix2::Fhir unless defined?(F)
  let(:resources) do
    { "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department,
      "Location/bed1" => ssmix2_location("bed1", "1", "bd", part_of: "room1"),
      "Location/room1" => ssmix2_location("room1", "302", "ro", part_of: "ward1"),
      "Location/ward1" => ssmix2_location("ward1", "32", "wa") }
  end
  let(:store) { ssmix2_store(resources) }
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before { ssmix2_enable! }

  # returned を省くと印を持つ前に書かれた外出泊(終了の日時で帰院済みかを判断する)。
  def leave(id:, start:, finish: nil, reason: nil, returned: nil)
    children = [{ "url" => "id", "valueString" => id }, { "url" => "start", "valueDateTime" => start }]
    children << { "url" => "end", "valueDateTime" => finish } if finish
    children << { "url" => "reason", "valueString" => reason } if reason
    children << { "url" => "returned", "valueBoolean" => returned } unless returned.nil?
    { "url" => F::LEAVE_EXT_URL, "extension" => children }
  end

  def with_leaves(*leaves) = ssmix2_admission.merge("extension" => leaves)

  def build(encounter, previous:, version: 2)
    allow(store).to receive(:read_or_nil).with("Encounter/enc1/_history", version - 1).and_return(previous)
    fresh = Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new)
    transaction = ssmix2_transaction(method: "PUT", path: "/Encounter/enc1", request: encounter, response: encounter)
    written = Ssmix2::Dispatcher::Written.new(method: "PUT", type: "Encounter", id: "enc1", version: version, resource: encounter)
    Array(described_class.new(context: fresh, transaction: transaction, written: written).build)
  end

  let(:going) { leave(id: "lv1", start: "2026-11-07T10:00:00+09:00", finish: "2026-11-08T17:00:00+09:00", reason: "外泊") }

  it "sends ADT^A21 when a leave is added, with the planned return in PV2-47 and the departure in EVN-3 / EVN-6" do
    results = build(with_leaves(going), previous: ssmix2_admission)

    expect(results.size).to eq(1)
    result = results.first
    expect(result.data_kind).to eq("ADT-31")
    expect(result.service_date).to eq("20261107")
    expect(result.process).to eq("INS")
    expect(result.department_code).to eq("01")
    expect(segment(result, "MSH")).to include("|ADT^A21^ADT_A21|")
    expect(segment(result, "EVN")).to eq("EVN||20261104103012|20261107100000||220^医師^一郎^^^^^^^L^^^^^I|20261107100000|2219999998")
    expect(segment(result, "PV1").split("|")[2..3]).to eq(%w[I 32^302^1^^^N])
    expect(segment(result, "PV2").split("|")[47]).to eq("20261108170000")
  end

  it "sends ADT^A22 on return and ADT^A53 (DEL) with the same order number when the return is undone" do
    left = with_leaves(leave(id: "lv1", start: "2026-11-02T10:00:00+09:00", finish: "2026-11-05T17:00:00+09:00", reason: "外泊"))
    returned = with_leaves(leave(id: "lv1", start: "2026-11-02T10:00:00+09:00", finish: "2026-11-03T16:30:00+09:00", reason: "外泊"))

    result = build(returned, previous: left).sole
    expect(result.data_kind).to eq("ADT-32")
    expect(result.service_date).to eq("20261103")
    expect(segment(result, "MSH")).to include("|ADT^A22^ADT_A21|")
    expect(segment(result, "EVN").split("|")[6]).to eq("20261103163000")

    undone = build(left, previous: returned, version: 3).sole
    expect(undone.data_kind).to eq("ADT-32")
    expect(undone.process).to eq("DEL")
    expect(undone.order_no).to eq(result.order_no)
    expect(segment(undone, "MSH")).to include("|ADT^A53^ADT_A52|")
  end

  it "sends ADT^A21 and ADT^A22 for a leave recorded after the return, and A52 + A53 when it is removed" do
    past = leave(id: "lv3", start: "2026-11-01T10:00:00+09:00", finish: "2026-11-02T15:00:00+09:00")
    recorded = build(with_leaves(past), previous: ssmix2_admission)
    expect(recorded.map { |r| segment(r, "MSH").split("|")[8] }).to eq(%w[ADT^A21^ADT_A21 ADT^A22^ADT_A21])
    expect(recorded.map { |r| segment(r, "MSH").split("|")[9] }.uniq.size).to eq(2)

    removed = build(ssmix2_admission, previous: with_leaves(past), version: 3)
    expect(removed.map { |r| [segment(r, "MSH").split("|")[8], r.process] }).to eq([["ADT^A52^ADT_A52", "DEL"], ["ADT^A53^ADT_A52", "DEL"]])
    expect(removed.map(&:order_no)).to eq(recorded.map(&:order_no))
  end

  it "keeps leaves apart by id: a new leave is A21 and a removed one A52 with its own order number" do
    other = leave(id: "lv2", start: "2026-11-07T10:00:00+09:00")
    first = build(with_leaves(going), previous: ssmix2_admission).sole

    results = build(with_leaves(other), previous: with_leaves(going), version: 3)
    expect(results.map { |r| [segment(r, "MSH").split("|")[8], r.process] }).to eq([["ADT^A21^ADT_A21", "INS"], ["ADT^A52^ADT_A52", "DEL"]])
    expect(results[0].order_no).not_to eq(first.order_no)
    expect(results[1].order_no).to eq(first.order_no)
  end

  it "uses the returned flag: a return at the planned time is A22, a planned end in the past is not" do
    planned = leave(id: "lv5", start: "2026-11-02T10:00:00+09:00", finish: "2026-11-03T17:00:00+09:00", returned: false)
    expect(build(with_leaves(planned), previous: ssmix2_admission).map { |r| segment(r, "MSH").split("|")[8] }).to eq(%w[ADT^A21^ADT_A21])

    returned = leave(id: "lv5", start: "2026-11-02T10:00:00+09:00", finish: "2026-11-03T17:00:00+09:00", returned: true)
    result = build(with_leaves(returned), previous: with_leaves(planned), version: 3).sole
    expect(segment(result, "MSH")).to include("|ADT^A22^ADT_A21|")
    expect(result.service_date).to eq("20261103")

    future = leave(id: "lv6", start: "2026-11-02T10:00:00+09:00", finish: "2026-11-06T17:00:00+09:00", returned: true)
    expect(build(with_leaves(future), previous: ssmix2_admission).map { |r| segment(r, "MSH").split("|")[8] }).to eq(%w[ADT^A21^ADT_A21 ADT^A22^ADT_A21])

    undone = build(with_leaves(planned), previous: with_leaves(returned), version: 4).sole
    expect(segment(undone, "MSH")).to include("|ADT^A53^ADT_A52|")
    expect(undone.order_no).to eq(result.order_no)
  end

  it "stays silent for unchanged leaves, plans and outpatient encounters, and matches a leave without an id by its start" do
    expect(build(with_leaves(going), previous: with_leaves(going))).to be_empty
    expect(build(with_leaves(going).merge("status" => "planned"), previous: ssmix2_admission)).to be_empty

    legacy = { "url" => F::LEAVE_EXT_URL, "extension" => [{ "url" => "start", "valueDateTime" => "2026-11-07T10:00:00+09:00" },
                                                          { "url" => "end", "valueDateTime" => "2026-11-08T17:00:00+09:00" },
                                                          { "url" => "reason", "valueString" => "外泊" }] }
    expect(build(with_leaves(going), previous: with_leaves(legacy))).to be_empty
  end
end
