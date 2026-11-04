require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::OulR22 do
  F = Ssmix2::Fhir unless const_defined?(:F)
  let(:specimen) do
    { "resourceType" => "Specimen", "id" => "sp1", "accessionIdentifier" => { "value" => "000000001219001" },
      "type" => { "coding" => [{ "system" => F::JLAC11_SPECIMEN_SYSTEM, "code" => "023", "display" => "血清" }] },
      "collection" => { "collectedDateTime" => "2026-11-03" } }
  end
  def observation(id, code, name, value, unit, flag, range: nil)
    { "resourceType" => "Observation", "id" => id, "status" => "final", "specimen" => { "reference" => "Specimen/sp1" },
      "code" => { "coding" => [{ "system" => F::RESULT_ITEM_SYSTEM, "code" => code, "display" => name },
                               { "system" => F::JLAC10_SYSTEM, "code" => "3A010000002327101", "display" => name },
                               { "system" => F::ABBREVIATION_SYSTEM, "code" => code, "display" => code }], "text" => name },
      "effectiveDateTime" => "2026-11-03",
      "valueQuantity" => { "value" => value, "unit" => unit, "system" => F::UCUM_SYSTEM, "code" => "g/dL" },
      "interpretation" => [{ "coding" => [{ "system" => F::INTERPRETATION_SYSTEM, "code" => flag }] }],
      "referenceRange" => range && [{ "low" => { "value" => range[0] }, "high" => { "value" => range[1] }, "text" => "#{range[0]}-#{range[1]}" }] }.compact
  end
  let(:report) do
    { "resourceType" => "DiagnosticReport", "id" => "dr1", "status" => "corrected", "subject" => { "reference" => "Patient/p1" },
      "category" => [{ "coding" => [{ "code" => "LAB" }] }, { "coding" => [{ "system" => F::LAB_RESULT_SETTING_SYSTEM, "code" => "outpatient" }] }],
      "effectiveDateTime" => "2026-11-03", "issued" => "2026-11-04T10:30:59+09:00",
      "basedOn" => [{ "reference" => "ServiceRequest/lab1" }], "specimen" => [{ "reference" => "Specimen/sp1" }],
      "result" => [{ "reference" => "Observation/o1" }, { "reference" => "Observation/o2" }],
      "extension" => [{ "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/dept1" } }] }
  end
  let(:o1) { observation("o1", "TP", "総蛋白", 7.2, "g/dL", "N", range: [6.7, 8.3]) }
  let(:o2) { observation("o2", "ALB", "アルブミン", 3.1, "g/dL", "L", range: [3.7, 5.5]).merge("note" => [{ "text" => "再検" }]) }
  let(:store) do
    ssmix2_store({ "Patient/p1" => ssmix2_patient, "Organization/dept1" => ssmix2_department },
                 searches: { ["Observation", { "_id" => "o1,o2" }] => [o1, o2], ["Specimen", { "_id" => "sp1" }] => [specimen] })
  end
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before { ssmix2_enable! }

  it "builds OUL^R22 with the specimen, the report status and one OBX per result" do
    transaction = ssmix2_transaction(method: "PUT", path: "/DiagnosticReport/dr1", request: report, response: report)
    written = Ssmix2::Dispatcher.written_resources(transaction).first

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(result.data_kind).to eq("OML-11")
    expect(result.service_date).to eq("20261103")
    expect(result.order_no).to eq(Ssmix2::OrderNumber.for("ServiceRequest/lab1"))
    expect(segment(result, "MSH")).to include("|OUL^R22^OUL_R22|")
    expect(segment(result, "SPM")).to eq("SPM|1|000000001219001||023^血清^JC11|||||||||||||20261103")
    obr = segment(result, "OBR").split("|")
    expect(obr[3]).to eq("dr1")
    expect(obr[7]).to eq("20261103")
    expect(obr[22]).to eq("20261104103059")
    expect(obr[25]).to eq("C")
    orc = segment(result, "ORC").split("|")
    expect(orc[1]).to eq("SC")
    expect(orc[3]).to eq("dr1")
    expect(orc[5]).to eq("CM")
    obxs = segments(result, "OBX")
    expect(obxs[0]).to eq("OBX|1|NM|3A010000002327101^総蛋白^JC10^TP^TP^99X03||7.2|g/dL^g/dL^UCUM|6.7-8.3|N|||F|||20261103")
    expect(obxs[1]).to eq("OBX|2|NM|3A010000002327101^アルブミン^JC10^ALB^ALB^99X03||3.1|g/dL^g/dL^UCUM|3.7-5.5|L|||F|||20261103")
    expect(segment(result, "NTE")).to eq("NTE|1||再検")
  end
end
