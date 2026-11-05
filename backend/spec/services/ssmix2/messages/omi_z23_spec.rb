require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::OmiZ23 do
  F = Ssmix2::Fhir unless defined?(F)
  let(:header) do
    { "resourceType" => "ServiceRequest", "id" => "rad1", "status" => "active", "subject" => { "reference" => "Patient/p1" },
      "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "rad" }] },
                     { "coding" => [{ "system" => F::PRESCRIPTION_SETTING_SYSTEM, "code" => "outpatient" }] }],
      "authoredOn" => "2026-11-04T10:30:45+09:00", "occurrenceDateTime" => "2026-11-06T09:30:00+09:00",
      "requester" => { "reference" => "Practitioner/doc1" },
      "extension" => [{ "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/dept1" } }] }
  end
  let(:item) do
    { "resourceType" => "ServiceRequest", "id" => "it1", "status" => "active", "basedOn" => [{ "reference" => "ServiceRequest/rad1" }],
      "category" => [{ "coding" => [{ "system" => F::JJ1017_MODALITY_SYSTEM, "code" => "6", "display" => "Ｘ線CT検査" }] }],
      "code" => { "coding" => [{ "system" => F::RAD_ORDER_ITEM_SYSTEM, "code" => "CT-HEAD", "display" => "頭部CT" },
                               { "system" => F::JJ1017_32_SYSTEM, "code" => "60000001000000000000000000000000", "display" => "頭部.CT" },
                               { "system" => F::JJ1017_16M_SYSTEM, "code" => "6000000100000000" }], "text" => "頭部CT" } }
  end
  let(:hub) do
    { "resourceType" => "Procedure", "status" => "completed", "subject" => { "reference" => "Patient/p1" },
      "category" => { "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "rad" }] },
      "code" => { "coding" => [{ "system" => F::RAD_PROCEDURE_CODE_SYSTEM, "code" => "170010410", "display" => "ＣＴ撮影" }] },
      "usedCode" => [{ "coding" => [{ "system" => F::RAD_MATERIAL_SYSTEM, "code" => "TUBE1", "display" => "造影剤注入用チューブ" }], "text" => "造影剤注入用チューブ",
                       "extension" => [{ "url" => F::MATERIAL_QUANTITY_EXT_URLS[0], "valueQuantity" => { "value" => 2, "unit" => "本" } }] }],
      "basedOn" => [{ "reference" => "ServiceRequest/rad1" }], "performedDateTime" => "2026-11-06T09:41:00+09:00",
      "performer" => [{ "actor" => { "reference" => "Practitioner/doc1" } }] }
  end
  let(:contrast) do
    { "resourceType" => "MedicationAdministration", "status" => "completed", "subject" => { "reference" => "Patient/p1" },
      "medicationCodeableConcept" => { "coding" => [{ "system" => F::MEDICINE_CODE_SYSTEM, "code" => "620004950", "display" => "イオパミロン" }], "text" => "イオパミロン" },
      "effectiveDateTime" => "2026-11-06T09:41:00+09:00", "partOf" => [{ "reference" => "urn:uuid:hub" }], "dosage" => { "dose" => { "value" => 1, "unit" => "本" } } }
  end
  let(:dose) do
    { "resourceType" => "Observation", "status" => "final", "subject" => { "reference" => "Patient/p1" }, "partOf" => [{ "reference" => "urn:uuid:hub" }],
      "code" => { "coding" => [{ "system" => F::RAD_DOSE_SYSTEM, "code" => "ctdi", "display" => "CTDIvol" }] },
      "valueQuantity" => { "value" => 12.5, "unit" => "mGy", "code" => "mGy" } }
  end
  let(:store) do
    ssmix2_store({ "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department, "ServiceRequest/rad1" => header },
                 searches: { ["ServiceRequest", { "based-on" => "ServiceRequest/rad1" }] => [item] })
  end
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before do
    ssmix2_enable!
    Master::HotCode.create!(hot_code: "111836001", receipt_code_1: "620004950")
  end

  def build
    entries = [{ "fullUrl" => "urn:uuid:hub", "resource" => hub, "request" => { "method" => "POST", "url" => "Procedure" } },
               { "fullUrl" => "urn:uuid:ma", "resource" => contrast, "request" => { "method" => "POST", "url" => "MedicationAdministration" } },
               { "fullUrl" => "urn:uuid:obs", "resource" => dose, "request" => { "method" => "POST", "url" => "Observation" } }]
    responses = %w[Procedure/proc1 MedicationAdministration/ma1 Observation/obs1].map { |ref| { "response" => { "status" => "201", "location" => "#{ref}/_history/1" } } }
    transaction = ssmix2_transaction(method: "POST", path: "/", request: { "resourceType" => "Bundle", "type" => "transaction", "entry" => entries },
                                     response: { "resourceType" => "Bundle", "type" => "transaction-response", "entry" => responses })
    written = Ssmix2::Dispatcher.written_resources(transaction).find { |w| w.type == "Procedure" }
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  it "builds OMI^Z23 (OMG-11) with the performed time, ZE1 for the item and the procedure, used items and the dose" do
    result = build

    expect(result.data_kind).to eq("OMG-11")
    expect(result.service_date).to eq("20261106")
    expect(result.process).to eq("INS")
    expect(segment(result, "MSH")).to include("|OMI^Z23^OMI_Z23|")
    expect(segments_of(result).map { |s| s.split("|").first }).to eq(%w[MSH PID PV1 ORC TQ1 OBR IPC ORC TQ1 OBR IPC ORC TQ1 OBR ZE1 ZE1 OBX IPC])
    orc = segment(result, "ORC").split("|")
    expect(orc[1]).to eq("NW")
    expect(orc[2]).to eq(result.order_no)
    expect(orc[3]).to match(/\A\d{15}\z/)
    expect(orc[5]).to eq("CM")
    obr = segment(result, "OBR").split("|")
    expect(obr[4]).to eq("6000000000000000^Ｘ線CT検査^JJ1017^6^Ｘ線CT検査^99ZRM")
    expect(obr[7]).to eq("202611060941")
    expect(obr[22]).to eq("20261104103012")
    expect(obr[25]).to eq("F")
    ipc = segment(result, "IPC").split("|")
    expect(ipc[1]).to eq(orc[3])
    expect(ipc[3]).to eq('""')
    expect(ipc[5]).to eq("CT^^DCM")
    ze1s = segments(result, "ZE1").map { |s| s.split("|") }
    expect(ze1s[0][1..3]).to eq(["1", "RS", "60000001000000000000000000000000^頭部.CT^JJ1017^CT-HEAD^頭部CT^99ZRI"])
    expect(ze1s[0][7]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    expect(ze1s[0][9]).to eq("111836001^イオパミロン^HOT9^1^HON&本&MR9P~TUBE1^造影剤注入用チューブ^99ZRM^2^本&本&99ZUN")
    expect(ze1s[1][1..3]).to eq(["2", "RS", "170010410^ＣＴ撮影^99ZRP"])
    expect(segment(result, "OBX")).to eq("OBX|1|NM|ctdi^CTDIvol^99ZRD||12.5|mGy^mGy^ISO+|||||F")
  end
end
