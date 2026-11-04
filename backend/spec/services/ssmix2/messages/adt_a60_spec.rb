require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::AdtA60 do
  let(:egg) do
    { "resourceType" => "AllergyIntolerance", "id" => "al1", "patient" => { "reference" => "Patient/p1" },
      "clinicalStatus" => { "coding" => [{ "code" => "active" }] }, "category" => ["food"], "criticality" => "high",
      "code" => { "coding" => [{ "system" => "jfagy-food", "code" => "JFF0001", "display" => "鶏卵" }], "text" => "鶏卵" },
      "reaction" => [{ "manifestation" => [{ "text" => "蕁麻疹" }] }], "onsetDateTime" => "2010-05", "recordedDate" => "2026-11-04" }
  end
  let(:drug) do
    { "resourceType" => "AllergyIntolerance", "id" => "al2", "patient" => { "reference" => "Patient/p1" },
      "category" => ["medication"], "criticality" => "low",
      "code" => { "coding" => [{ "system" => "jfagy-ycm", "code" => "Y1124001F1023", "display" => "ロキソニン錠" }] } }
  end
  let(:store) do
    ssmix2_store({ "Patient/p1" => ssmix2_patient },
                 searches: { ["AllergyIntolerance", { "patient" => "Patient/p1" }] => [egg, drug] })
  end
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before do
    ssmix2_enable!
    Master::HotCode.create!(hot_code: "108665201", individual_medicine_code: "1124001F1023")
  end

  def build(resource, method:, id:)
    transaction = ssmix2_transaction(method: method, path: "/AllergyIntolerance/#{id}", request: resource, response: resource)
    written = Ssmix2::Dispatcher::Written.new(method: method, type: "AllergyIntolerance", id: id, resource: resource)
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  it "lists every allergy of the patient, marking the written one as added and resolving HOT9 for drugs" do
    result = build(egg, method: "POST", id: "al1")

    expect(result.data_kind).to eq("ADT-61")
    expect(result.service_date).to eq("-")
    expect(result.order_no).to eq("ALL9")
    expect(segment(result, "MSH")).to include("|ADT^A60^ADT_A60|")
    iams = segments(result, "IAM")
    expect(iams[0]).to eq("IAM|1|FA^食物アレルギー^HL70127|JFF0001^鶏卵^99JFAGY|SV^重度^HL70128|蕁麻疹|A^追加^HL70323|||||201005||20261104")
    expect(iams[1]).to eq("IAM|2|DA^薬物アレルギー^HL70127|108665201^ロキソニン錠^HOT9^Y1124001F1023^ロキソニン錠^99JFAGY|MI^軽度^HL70128||X^変更なし^HL70323")
  end

  it "marks a deleted allergy with D using its last version" do
    allow(store).to receive(:search).with("AllergyIntolerance/al2/_history", {}, limit: 50).and_return([drug])

    result = build(nil, method: "DELETE", id: "al2")

    expect(segments(result, "IAM")[0]).to include("|D^削除^HL70323")
    expect(segments(result, "IAM").size).to eq(2)
  end
end
