require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::OmlO33 do
  F = Ssmix2::Fhir unless defined?(F)
  let(:header) do
    { "resourceType" => "ServiceRequest", "id" => "lab1", "status" => "active", "priority" => "urgent",
      "subject" => { "reference" => "Patient/p1" },
      "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "lab" }] },
                     { "coding" => [{ "system" => F::PRESCRIPTION_SETTING_SYSTEM, "code" => "outpatient" }] }],
      "authoredOn" => "2026-11-04T18:33:01+09:00", "occurrenceDateTime" => "2026-11-05",
      "requester" => { "reference" => "Practitioner/doc1" },
      "extension" => [{ "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/dept1" } }] }
  end
  def item(id, code, name, jlac, specimen, parent: "ServiceRequest/lab1")
    { "resourceType" => "ServiceRequest", "id" => id, "status" => "active", "basedOn" => [{ "reference" => parent }],
      "subject" => { "reference" => "Patient/p1" },
      "code" => { "coding" => [{ "system" => F::LAB_ORDER_ITEM_SYSTEM, "code" => code, "display" => name },
                               { "system" => F::JLAC10_SYSTEM, "code" => jlac, "display" => name },
                               { "system" => F::ABBREVIATION_SYSTEM, "code" => code, "display" => code }], "text" => name },
      "contained" => [{ "resourceType" => "Specimen", "id" => "specimen",
                        "type" => { "coding" => [{ "system" => F::JLAC11_SPECIMEN_SYSTEM, "code" => specimen, "display" => specimen == "023" ? "血清" : "血漿" }] } }],
      "specimen" => [{ "reference" => "#specimen" }] }
  end
  let(:items) { [item("i1", "TP", "総蛋白", "3A010000002327101", "023"), item("i2", "PT", "ＰＴ", "2B030000002231101", "022"), item("i3", "TBIL", "総ビリルビン", "3J010000002327101", "023")] }
  let(:store) do
    ssmix2_store({ "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department },
                 searches: { ["ServiceRequest", { "based-on" => "ServiceRequest/lab1" }] => items })
  end
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before { ssmix2_enable! }

  it "groups the requested items by specimen into SPM / ORC / OBR / OBX" do
    transaction = ssmix2_transaction(method: "PUT", path: "/ServiceRequest/lab1", request: header, response: header)
    written = Ssmix2::Dispatcher.written_resources(transaction).first

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(result.data_kind).to eq("OML-01")
    expect(result.service_date).to eq("20261104")
    expect(segment(result, "MSH")).to include("|OML^O33^OML_O33|")
    spms = segments(result, "SPM")
    expect(spms[0]).to eq("SPM|1|||022^血漿^JC11|||||||||||||20261105")
    expect(spms[1]).to eq("SPM|2|||023^血清^JC11|||||||||||||20261105")
    expect(segments(result, "ORC").size).to eq(2)
    obr = segments(result, "OBR")[1].split("|")
    expect(obr[2]).to eq(result.order_no)
    expect(obr[4]).to eq("^検体検査^99O03")
    expect(obr[5]).to eq("S")
    expect(obr[16]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    obxs = segments(result, "OBX")
    expect(obxs[0]).to eq("OBX|1||2B030000002231101^ＰＴ^JC10^PT^PT^99X03||||||||O")
    expect(obxs[1]).to eq("OBX|1||3A010000002327101^総蛋白^JC10^TP^TP^99X03||||||||O")
    expect(obxs[2]).to eq("OBX|2||3J010000002327101^総ビリルビン^JC10^TBIL^TBIL^99X03||||||||O")
  end

  it "sends the CA control record as DEL when the order is revoked" do
    revoked = header.merge("status" => "revoked")
    transaction = ssmix2_transaction(method: "PUT", path: "/ServiceRequest/lab1", request: revoked, response: revoked)
    written = Ssmix2::Dispatcher.written_resources(transaction).first

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(result.process).to eq("DEL")
    expect(segments(result, "ORC").all? { |orc| orc.start_with?("ORC|CA|") }).to be(true)
  end
end
