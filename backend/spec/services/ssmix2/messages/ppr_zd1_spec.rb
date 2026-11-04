require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::PprZd1 do
  let(:gastritis) do
    { "resourceType" => "Condition", "id" => "c1", "subject" => { "reference" => "Patient/p1" },
      "clinicalStatus" => { "coding" => [{ "code" => "active" }] }, "verificationStatus" => { "coding" => [{ "code" => "provisional" }] },
      "code" => {
        "extension" => [{ "url" => Ssmix2::Fhir::POSTFIX_MODIFIER_EXT_URL,
                          "valueCodeableConcept" => { "coding" => [{ "system" => Ssmix2::Fhir::MODIFIER_KEY_NUMBER_SYSTEM, "code" => "27000001", "display" => "の疑い" },
                                                                   { "system" => Ssmix2::Fhir::MODIFIER_EXCHANGE_SYSTEM, "code" => "5395" }] } }],
        "coding" => [{ "system" => Ssmix2::Fhir::DISEASE_KEY_NUMBER_SYSTEM, "code" => "20054174", "display" => "胃炎" },
                     { "system" => Ssmix2::Fhir::DISEASE_EXCHANGE_SYSTEM, "code" => "TSQF" },
                     { "system" => Ssmix2::Fhir::ICD10_SYSTEM, "code" => "K297" }],
        "text" => "胃炎の疑い"
      },
      "onsetDateTime" => "2026-08-31", "recordedDate" => "2026-09-15", "note" => [{ "text" => "内視鏡で確認予定" }] }
  end
  let(:healed) do
    { "resourceType" => "Condition", "id" => "c2", "subject" => { "reference" => "Patient/p1" },
      "clinicalStatus" => { "coding" => [{ "code" => "resolved" }] },
      "code" => { "coding" => [{ "system" => Ssmix2::Fhir::DISEASE_KEY_NUMBER_SYSTEM, "code" => "20050001", "display" => "急性上気道炎" }], "text" => "急性上気道炎" },
      "onsetDateTime" => "2026-01-10", "abatementDateTime" => "2026-01-20", "recordedDate" => "2026-01-10" }
  end
  let(:nursing) do
    { "resourceType" => "Condition", "id" => "c9", "subject" => { "reference" => "Patient/p1" },
      "category" => [{ "coding" => [{ "system" => Ssmix2::Fhir::CONDITION_LOCAL_CATEGORY_SYSTEM, "code" => "nursing-problem" }] }],
      "code" => { "text" => "転倒リスク" } }
  end
  let(:store) do
    ssmix2_store({ "Patient/p1" => ssmix2_patient }, searches: { ["Condition", { "patient" => "Patient/p1" }] => [healed, gastritis, nursing] })
  end
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before { ssmix2_enable! }

  it "lists the patient's diagnoses with PRB and ZPR, marking the written one as added" do
    transaction = ssmix2_transaction(method: "POST", path: "/Condition", request: gastritis, response: gastritis)
    written = Ssmix2::Dispatcher::Written.new(method: "POST", type: "Condition", id: "c1", resource: gastritis)

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(result.data_kind).to eq("PPR-01")
    expect(segment(result, "MSH")).to include("|PPR^ZD1^PPR_ZD1|")
    prbs = segments(result, "PRB")
    expect(prbs[0]).to eq("PRB|AD|20261104103012|20054174^胃炎^MDCDX2|c1|||20260915|||K297^^I10|||1^疑いあり^JHSD0005|C^継続^JHSD0006||20260831|胃炎の疑い")
    expect(prbs[1]).to eq("PRB|UC|20261104103012|20050001^急性上気道炎^MDCDX2|c2|||20260110||20260120|||||F^完全に回復した^HL70241|20260120|20260110|急性上気道炎")
    expect(segments(result, "ZPR")[0]).to eq("ZPR||20054174^胃炎^MDCDX2|27000001^の疑い^MDCDX2||TSQF^胃炎の疑い^MDCDX2|5395^の疑い^MDCDX2|内視鏡で確認予定")
    expect(result.hl7).not_to include("転倒リスク")
  end
end
