require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::OmgO19 do
  F = Ssmix2::Fhir unless defined?(F)
  let(:header) do
    { "resourceType" => "ServiceRequest", "id" => "rad1", "status" => "active", "intent" => "order", "priority" => "urgent",
      "subject" => { "reference" => "Patient/p1" },
      "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "rad" }] },
                     { "coding" => [{ "system" => F::PRESCRIPTION_SETTING_SYSTEM, "code" => "outpatient" }] }],
      "authoredOn" => "2026-11-04T10:30:45+09:00", "occurrenceDateTime" => "2026-11-06T09:30:00+09:00",
      "requester" => { "reference" => "Practitioner/doc1" },
      "extension" => [{ "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/dept1" } }] }
  end
  def rad_item(id, number, code, jj1017, name)
    { "resourceType" => "ServiceRequest", "id" => id, "status" => "active", "subject" => { "reference" => "Patient/p1" },
      "identifier" => [{ "system" => "http://fhir-client.local/IdSystem/rad-order-item-number", "value" => number.to_s }],
      "basedOn" => [{ "reference" => "ServiceRequest/rad1" }],
      "category" => [{ "coding" => [{ "system" => F::JJ1017_MODALITY_SYSTEM, "code" => "1", "display" => "Ｘ線単純撮影" }] }],
      "code" => { "coding" => [{ "system" => F::RAD_ORDER_ITEM_SYSTEM, "code" => code, "display" => name },
                               { "system" => F::JJ1017_32_SYSTEM, "code" => jj1017, "display" => name },
                               { "system" => F::JJ1017_16M_SYSTEM, "code" => jj1017[0, 16] }], "text" => name } }
  end
  let(:items) { [rad_item("it1", 1, "XP-CHEST-PA", "10000002000102000000010000000000", "胸部.Ｘ線単純撮影.立位正面"), rad_item("it2", 2, "XP-CHEST-LAT", "10000002000106000000010000000000", "胸部.Ｘ線単純撮影.立位側面")] }
  let(:store) do
    ssmix2_store({ "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department },
                 searches: { ["ServiceRequest", { "based-on" => "ServiceRequest/rad1" }] => items })
  end
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before { ssmix2_enable! }

  def build(resource, method: "PUT")
    transaction = ssmix2_transaction(method: method, path: "/ServiceRequest/rad1", request: resource, response: resource)
    written = Ssmix2::Dispatcher::Written.new(method: method, type: "ServiceRequest", id: "rad1", version: 1, resource: resource)
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  it "builds OMG^O19 (OMG-01) with the control, parent and child records and JJ1017 codes" do
    result = build(header)

    expect(result.data_kind).to eq("OMG-01")
    expect(result.service_date).to eq("20261104")
    expect(result.department_code).to eq("01")
    expect(segment(result, "MSH")).to include("|OMG^O19^OMG_O19|")
    expect(segments_of(result).map { |s| s.split("|").first }).to eq(%w[MSH PID PV1 ORC TQ1 OBR ORC TQ1 OBR ORC TQ1 OBR ORC TQ1 OBR])
    orcs = segments(result, "ORC").map { |s| s.split("|") }
    expect(orcs.map { |o| o[1] }).to eq(%w[NW PA CH CH])
    expect(orcs[0][2]).to eq(result.order_no)
    expect(orcs[2][2]).to match(/\A\d{15}\z/)
    expect(orcs[2][2]).not_to eq(result.order_no)
    expect(orcs[2][8]).to eq(result.order_no)
    expect(orcs[0][29]).to eq("O^外来患者オーダ^HL70482")
    tq1 = segment(result, "TQ1").split("|")
    expect(tq1[1]).to eq("1")
    expect(tq1[7]).to eq("202611060930")
    expect(tq1[9]).to eq("S^^HL70485")
    obrs = segments(result, "OBR").map { |s| s.split("|") }
    expect(obrs[0][4]).to eq("1000000000000000^Ｘ線単純撮影^JJ1017^1^Ｘ線単純撮影^99ZRM")
    expect(obrs[0][16]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    expect(obrs[2][4]).to eq("10000002000102000000010000000000^胸部.Ｘ線単純撮影.立位正面^JJ1017^XP-CHEST-PA^胸部.Ｘ線単純撮影.立位正面^99ZRI")
    expect(obrs[2][29]).to eq(result.order_no)
    expect(obrs[3][4]).to start_with("10000002000106000000010000000000^")
  end

  it "sends only the CA control record when the order is cancelled" do
    result = build(header.merge("status" => "revoked"))

    expect(result.process).to eq("DEL")
    expect(segments(result, "ORC").size).to eq(1)
    expect(segment(result, "ORC").split("|")[1]).to eq("CA")
  end

  it "builds OMG-03 for a physiology order with the exam type as the parent code" do
    physio = header.merge("id" => "ph1", "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "physio" }] }], "priority" => "routine")
    item = { "resourceType" => "ServiceRequest", "id" => "pi1", "status" => "active", "basedOn" => [{ "reference" => "ServiceRequest/ph1" }],
             "category" => [{ "coding" => [{ "system" => F::PHYSIO_EXAM_TYPE_SYSTEM, "code" => "ECG", "display" => "心電図" }] }],
             "code" => { "coding" => [{ "system" => F::PHYSIO_ORDER_ITEM_SYSTEM, "code" => "ECG12", "display" => "標準１２誘導心電図" }], "text" => "標準１２誘導心電図" } }
    allow(store).to receive(:search).with("ServiceRequest", hash_including("based-on" => "ServiceRequest/ph1"), anything).and_return([item])
    transaction = ssmix2_transaction(method: "POST", path: "/ServiceRequest", request: physio, response: physio)
    written = Ssmix2::Dispatcher::Written.new(method: "POST", type: "ServiceRequest", id: "ph1", version: 1, resource: physio)

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(result.data_kind).to eq("OMG-03")
    obrs = segments(result, "OBR").map { |s| s.split("|") }
    expect(obrs[0][4]).to eq("^^^ECG^心電図^99ZPE")
    expect(obrs[2][4]).to eq("ECG12^標準１２誘導心電図^99ZPI")
    expect(segment(result, "TQ1").split("|")[9]).to eq("R^^HL70485")
  end
end
