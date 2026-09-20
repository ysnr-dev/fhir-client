require "rails_helper"

RSpec.describe Integrations::ReceiptComputer::CoverageResource do
  def record(**overrides)
    Integrations::ReceiptComputer::Records::CoverageRecord.new(
      { external_key: "ins-abc", kind: :insurance, type_code: "060", type_name: "国保",
        insurer_number: "138057", insurer_name: "国保",
        symbol: "テスト", number: "１２３４", branch: "01", relationship: "self",
        period_start: "2026-04-01", period_end: "2027-03-31", copay_percent: 30 }.merge(overrides)
    )
  end

  def set(key: "0001", label: "国保 30%")
    Integrations::ReceiptComputer::Records::CoverageSet.new(
      key: key, label: label, member_keys: ["ins-abc"], copay_percent: 30
    )
  end

  def build(sets: [set], **record_overrides)
    described_class.build(record(**record_overrides), patient_number: "00002",
                                                      patient_fhir_id: "pat-1", sets: sets, order: 1)
  end

  it "identifies the Coverage by 患者番号 と レセコン側のキー so it can be updated in place" do
    expect(build["identifier"])
      .to eq([{ "system" => "http://fhir-client.local/integrations/receipt-computer/coverage",
                "value" => "00002:ins-abc" }])
  end

  it "satisfies the required elements the 上流 validates" do
    coverage = build

    expect(coverage["status"]).to eq("active")
    expect(coverage["beneficiary"]).to eq({ "reference" => "Patient/pat-1" })
    expect(coverage["payor"].length).to eq(1)
  end

  # 保険者は Organization を作らずに論理参照で指す。
  it "points at the 保険者 by number without creating an Organization" do
    expect(build["payor"].first)
      .to eq({ "identifier" => { "system" => "urn:oid:1.2.392.100495.20.3.61", "value" => "138057" },
               "display" => "国保" })
  end

  # payor は 1..* が必須なので、番号の無い保険でも名称だけで満たす。
  it "still supplies a payor when the 保険者番号 is unknown" do
    coverage = build(insurer_number: nil, insurer_name: "自費")

    expect(coverage["payor"]).to eq([{ "display" => "自費" }])
  end

  it "carries 記号・番号・枝番 in the JP Core extensions" do
    values = build["extension"].to_h { |e| [e["url"].split("_").last, e["valueString"]] }

    expect(values).to eq("InsuredPersonSymbol" => "テスト",
                         "InsuredPersonNumber" => "１２３４",
                         "InsuredPersonSubNumber" => "01")
  end

  # 請求セット(保険組合せ)はレセコンが採番した不透明なキー。カルテは中身を解釈しない。
  it "records every 請求セット the 保険 belongs to" do
    second = Integrations::ReceiptComputer::Records::CoverageSet.new(
      key: "0002", label: "国保 + 公費", member_keys: ["ins-abc"]
    )

    entries = build(sets: [set, second])["class"]

    expect(entries.map { |c| c["value"] }).to eq(%w[0001 0002])
    expect(entries.first["type"]["coding"].first["code"]).to eq("billing-set")
  end

  it "states the 負担割合 as a percentage" do
    cost = build["costToBeneficiary"].first

    expect(cost["valueQuantity"]).to include("value" => 30, "code" => "%")
  end

  # 期限なしは period.end を出さないことで表す。
  it "omits the end of an open-ended 期間" do
    expect(build(period_end: nil)["period"]).to eq({ "start" => "2026-04-01" })
  end

  it "puts the 受給者番号 on a 公費 instead of 記号・番号" do
    coverage = build(kind: :public, external_key: "pub-1", recipient_number: "7654321",
                     symbol: nil, number: nil, branch: nil, copay_percent: nil)

    expect(coverage["subscriberId"]).to eq("7654321")
    expect(coverage).not_to have_key("extension")
    expect(coverage).not_to have_key("costToBeneficiary")
  end
end
