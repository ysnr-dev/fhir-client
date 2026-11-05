require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::OmdO03 do
  F = Ssmix2::Fhir unless defined?(F)
  let(:header) do
    { "resourceType" => "ServiceRequest", "id" => "meal1", "status" => "active", "subject" => { "reference" => "Patient/p1" },
      "encounter" => { "reference" => "Encounter/enc1" },
      "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "meal" }] },
                     { "coding" => [{ "system" => F::PRESCRIPTION_SETTING_SYSTEM, "code" => "inpatient" }] }],
      "authoredOn" => "2026-11-04T10:30:45+09:00", "occurrenceDateTime" => "2026-11-05T08:00:00+09:00",
      "requester" => { "reference" => "Practitioner/doc1" },
      "code" => { "coding" => [{ "system" => F::MEAL_TYPE_SYSTEM, "code" => "A00105", "display" => "一般食2000kcal" }], "text" => "一般食2000kcal" },
      "orderDetail" => [
        { "extension" => [{ "url" => F::MEAL_TIMING_EXT_URL, "valueCode" => "breakfast" }], "coding" => [{ "system" => F::MEAL_STAPLE_FOOD_SYSTEM, "code" => "105HI", "display" => "パン" }] },
        { "extension" => [{ "url" => F::MEAL_TIMING_EXT_URL, "valueCode" => "dinner" }], "coding" => [{ "system" => F::MEAL_STAPLE_FOOD_SYSTEM, "code" => "105AG", "display" => "米飯180g" }] },
        { "coding" => [{ "system" => F::MEAL_SIDE_DISH_FORM_SYSTEM, "code" => "KIZAMI", "display" => "きざみ" }] }
      ],
      "extension" => [
        { "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/dept1" } },
        { "url" => F::MEAL_SKIPPED_TIMING_EXT_URL, "valueCode" => "lunch" },
        { "url" => F::MEAL_SALT_LIMIT_EXT_URL, "valueQuantity" => { "value" => 6, "unit" => "g" } },
        { "url" => F::MEAL_ORDER_END_EXT_URL, "valueDateTime" => "2026-11-08T18:00:00+09:00" }
      ],
      "supportingInfo" => [{ "reference" => "AllergyIntolerance/al1" }],
      "note" => [{ "text" => "食事は常温で" }] }
  end
  let(:allergy) do
    { "resourceType" => "AllergyIntolerance", "id" => "al1", "category" => ["food"], "criticality" => "high",
      "code" => { "coding" => [{ "code" => "J9FA0001", "display" => "鶏卵" }], "text" => "鶏卵" } }
  end
  let(:resources) do
    { "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department,
      "Encounter/enc1" => ssmix2_admission, "AllergyIntolerance/al1" => allergy,
      "Location/bed1" => ssmix2_location("bed1", "1", "bd", part_of: "room1"),
      "Location/room1" => ssmix2_location("room1", "302", "ro", part_of: "ward1"), "Location/ward1" => ssmix2_location("ward1", "32", "wa") }
  end
  let(:store) { ssmix2_store(resources) }
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before { ssmix2_enable! }

  def build(resource, method: "PUT")
    transaction = ssmix2_transaction(method: method, path: "/ServiceRequest/meal1", request: resource, response: resource)
    written = Ssmix2::Dispatcher::Written.new(method: method, type: "ServiceRequest", id: "meal1", version: 1, resource: resource)
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  it "builds OMD^O03 with the diet, the staples per meal, a skipped meal, allergies and the period" do
    result = build(header)

    expect(result.data_kind).to eq("OMD")
    expect(result.service_date).to eq("20261104")
    expect(result.process).to eq("INS")
    expect(segment(result, "MSH")).to include("|OMD^O03^OMD_O03|")
    expect(segment(result, "PV1").split("|")[2..3]).to eq(%w[I 32^302^1^^^N])
    expect(segment(result, "AL1")).to eq("AL1|1|FA^食物アレルギー^HL70127|J9FA0001^鶏卵^99ZAL|SV^重度^HL70128")
    expect(segment(result, "ORC").split("|")[1..2]).to eq(["NW", result.order_no])
    tq1 = segment(result, "TQ1").split("|")
    expect(tq1[3]).to eq("TID&１日３回&HL70335")
    expect(tq1[7..9]).to eq(%w[2026110508 2026110818 R^ルーチン^HL70485])
    expect(segments(result, "ODS")).to eq([
      "ODS|T||A00105^一般食2000kcal^99ZMD|副食形態 きざみ~塩分 6g",
      "ODS|T|3^昼食^99ZMT|NPO^食止め^SSMIXTF01",
      "ODS|D|1^朝食^99ZMT|105HI^パン^99ZMS",
      "ODS|D|5^夕食^99ZMT|105AG^米飯180g^99ZMS"
    ])
    expect(segment(result, "NTE")).to eq("NTE|1||食事は常温で")
  end

  it "writes a fasting diet as NPO with the local code alongside, and cancels with CA / DEL" do
    Master::MealDiet.create!(item_code: "NPO01", name: "食止め", is_fasting: true)
    fasting = header.merge("code" => { "coding" => [{ "system" => F::MEAL_TYPE_SYSTEM, "code" => "NPO01", "display" => "食止め" }] }, "status" => "revoked")

    result = build(fasting)

    expect(result.process).to eq("DEL")
    expect(segment(result, "ORC").split("|")[1]).to eq("CA")
    expect(segments(result, "ODS").first).to eq("ODS|T||NPO^食止め^SSMIXTF01^NPO01^食止め^99ZMD|副食形態 きざみ~塩分 6g")
  end

  it "ignores other order kinds" do
    expect(build(header.merge("category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "lab" }] }]))).to be_nil
  end
end
