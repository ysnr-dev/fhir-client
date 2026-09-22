require "rails_helper"

RSpec.describe Integrations::Orca::DiseaseMessage do
  def diagnosis(outcome: nil, codes: %w[4609008], prefix: [], postfix: [])
    Integrations::ReceiptComputer::Records::Diagnosis.new(
      name: "病名", codes: codes, modifier_codes: { prefix: prefix, postfix: postfix },
      suspected: false, start_date: "2026-09-01", end_date: nil, outcome: outcome
    )
  end

  def child(**attrs) = described_class.build([diagnosis(**attrs)], "0001").first.first

  # diseasev2 の Disease_OutCome は F 治ゆ / D 死亡 / N R S U W 中止 / O 削除。
  # C は存在せず、D は死亡なので、カルテの inactive を D にすると死亡扱いになる。
  it "sends 治ゆ as F" do
    expect(child(outcome: :resolved)["Disease_OutCome"]).to eq("F")
  end

  it "sends an inactive 病名 as 不変 (中止), never as 死亡" do
    expect(child(outcome: :inactive)["Disease_OutCome"]).to eq("N")
  end

  it "leaves 継続 without a 転帰" do
    expect(child(outcome: nil)).not_to have_key("Disease_OutCome")
  end

  it "prefixes 修飾語 with ZZZ and orders 接頭語 → 病名 → 接尾語" do
    codes = child(prefix: %w[2056], postfix: %w[8002])["Disease_Single"].map { |d| d["Disease_Single_Code"] }

    expect(codes).to eq(%w[ZZZ2056 4609008 ZZZ8002])
  end

  it "reports 病名 without a code instead of dropping them" do
    _, skipped = described_class.build([diagnosis(codes: [])], "0001")

    expect(skipped.first[:reason]).to include("レセプト電算コード")
  end
end
