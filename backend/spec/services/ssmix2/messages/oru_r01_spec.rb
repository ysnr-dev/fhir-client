require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::OruR01 do
  F = Ssmix2::Fhir unless defined?(F)
  let(:header) do
    { "resourceType" => "ServiceRequest", "id" => "ph1", "status" => "active", "subject" => { "reference" => "Patient/p1" },
      "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "physio" }] }],
      "authoredOn" => "2026-11-04T10:30:45+09:00", "requester" => { "reference" => "Practitioner/doc1" } }
  end
  let(:item) do
    { "resourceType" => "ServiceRequest", "id" => "pi1", "status" => "active", "basedOn" => [{ "reference" => "ServiceRequest/ph1" }],
      "category" => [{ "coding" => [{ "system" => F::PHYSIO_EXAM_TYPE_SYSTEM, "code" => "ECG", "display" => "心電図" }] }],
      "code" => { "coding" => [{ "system" => F::PHYSIO_ORDER_ITEM_SYSTEM, "code" => "ECG12", "display" => "標準１２誘導心電図" }], "text" => "標準１２誘導心電図" } }
  end
  let(:findings) do
    { "resourceType" => "Observation", "id" => "obs1", "status" => "final", "subject" => { "reference" => "Patient/p1" },
      "code" => { "coding" => [{ "system" => F::PHYSIO_REPORT_ITEM_SYSTEM, "code" => "findings", "display" => "所見" }] },
      "effectiveDateTime" => "2026-11-06T10:00:00+09:00", "valueString" => "心筋虚血疑い" }
  end
  let(:report) do
    { "resourceType" => "DiagnosticReport", "id" => "dr1", "status" => "final", "subject" => { "reference" => "Patient/p1" },
      "basedOn" => [{ "reference" => "ServiceRequest/ph1" }],
      "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "physio" }] },
                     { "coding" => [{ "system" => "http://terminology.hl7.org/CodeSystem/v2-0074", "code" => "OTH" }] },
                     { "coding" => [{ "system" => F::PRESCRIPTION_SETTING_SYSTEM, "code" => "outpatient" }] }],
      "code" => { "text" => "標準１２誘導心電図" }, "effectiveDateTime" => "2026-11-06T10:00:00+09:00", "issued" => "2026-11-06T11:20:30+09:00",
      "result" => [{ "reference" => "Observation/obs1" }], "conclusion" => "虚血性変化あり。循環器内科に紹介",
      "extension" => [{ "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/dept1" } }] }
  end
  let(:store) do
    ssmix2_store({ "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department,
                   "ServiceRequest/ph1" => header, "Observation/obs1" => findings },
                 searches: { ["ServiceRequest", { "based-on" => "ServiceRequest/ph1" }] => [item], ["Observation", { "_id" => "obs1" }] => [findings] })
  end
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before { ssmix2_enable! }

  def build(resource, method: "PUT")
    transaction = ssmix2_transaction(method: method, path: "/DiagnosticReport/dr1", request: resource, response: resource)
    written = Ssmix2::Dispatcher::Written.new(method: method, type: "DiagnosticReport", id: "dr1", version: 1, resource: resource)
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  it "builds ORU^R01 (OMG-13) with the exam, the findings and the conclusion as TX observations" do
    result = build(report)

    expect(result.data_kind).to eq("OMG-13")
    expect(result.service_date).to eq("20261106")
    expect(result.process).to eq("INS")
    expect(result.department_code).to eq("01")
    expect(segment(result, "MSH")).to include("|ORU^R01^ORU_R01|")
    expect(segments_of(result).map { |s| s.split("|").first }).to eq(%w[MSH PID PV1 ORC OBR OBX OBX])
    orc = segment(result, "ORC").split("|")
    expect(orc[1]).to eq("SC")
    expect(orc[2]).to eq(result.order_no)
    expect(orc[3]).to eq("dr1")
    expect(orc[5]).to eq("CM")
    obr = segment(result, "OBR").split("|")
    expect(obr[1]).to eq("1")
    expect(obr[4]).to eq("ECG12^標準１２誘導心電図^99ZPI")
    expect(obr[7]).to eq("202611061000")
    expect(obr[16]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    expect(obr[22]).to eq("20261106112030")
    expect(obr[25]).to eq("F")
    obxs = segments(result, "OBX")
    expect(obxs[0]).to eq("OBX|1|TX|findings^所見^99ZPF||心筋虚血疑い||||||F|||20261106100000")
    expect(obxs[1]).to eq("OBX|2|TX|conclusion^判定^99ZPF||虚血性変化あり。循環器内科に紹介||||||F|||20261106100000")
  end

  it "marks an amended report C and ignores lab reports" do
    amended = build(report.merge("status" => "amended"))
    expect(amended.process).to eq("INS")
    expect(segment(amended, "OBR").split("|")[25]).to eq("C")

    lab = report.merge("category" => [{ "coding" => [{ "system" => "http://terminology.hl7.org/CodeSystem/v2-0074", "code" => "LAB" }] }])
    expect(build(lab)).to be_nil
  end
end
