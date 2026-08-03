require "rails_helper"

RSpec.describe Master::DoseConversionBuilder do
  def create_medicine(code, attrs = {})
    Master::Medicine.create!({ medicine_code: code, name: "テスト薬#{code}", unit_name: "管" }.merge(attrs))
  end

  def create_hot(standard_unit, attrs = {})
    Master::HotCode.create!({ hot_code: "H#{standard_unit.object_id}", standard_unit: standard_unit }.merge(attrs))
  end

  # 並びは DB のコレーションに依存させず Ruby 側で揃える。
  def conversions_for(code)
    Master::MedicineDoseConversion.where(medicine_code: code)
      .pluck(:from_unit, :factor, :to_unit, :source)
      .map { |from_unit, factor, to_unit, source| [from_unit, factor.to_f, to_unit, source] }
      .sort_by(&:first)
  end

  it "力価量が明示された規格から力価行を作る" do
    create_medicine("610000001", unit_name: "錠")
    create_hot("１０ｍｇ１錠", receipt_code_1: "610000001")

    described_class.call

    expect(conversions_for("610000001")).to eq([["mg", 10.0, "錠", "explicit"]])
  end

  it "力価と容量の両方が読める注射薬には2行を作る" do
    create_medicine("620000001")
    create_hot("３０ｍｇ２０ｍＬ１管", receipt_code_1: "620000001")

    described_class.call

    expect(conversions_for("620000001")).to eq([
      ["mL", 20.0, "管", "volume"],
      ["mg", 30.0, "管", "explicit"],
    ])
  end

  it "濃度%から力価を算出する" do
    create_medicine("620000002")
    create_hot("０．５％１ｍＬ１管", receipt_code_1: "620000002")

    described_class.call

    expect(conversions_for("620000002")).to eq([
      ["mL", 1.0, "管", "volume"],
      ["mg", 5.0, "管", "from_percent"],
    ])
  end

  it "力価行を作れた散剤には 1:1 の行を作らない" do
    create_medicine("610000010", unit_name: "ｇ")
    create_hot("２％１ｇ", receipt_code_1: "610000010")

    described_class.call

    expect(conversions_for("610000010")).to eq([["mg", 20.0, "ｇ", "from_percent"]])
  end

  it "薬価算定単位が量そのものなら 1:1 の行を作る" do
    create_medicine("610000002", unit_name: "ｇ")
    create_hot("１０ｇ", receipt_code_1: "610000002")

    described_class.call

    expect(conversions_for("610000002")).to eq([["g", 1.0, "ｇ", "identity"]])
  end

  it "容量しか読めない輸液には容量行だけを作る" do
    create_medicine("620000003", unit_name: "袋")
    create_hot("２５０ｍＬ１袋", receipt_code_1: "620000003")

    described_class.call

    expect(conversions_for("620000003")).to eq([["mL", 250.0, "袋", "volume"]])
  end

  it "レセプト電算コードで引けなければ個別医薬品コードで規格単位を引く" do
    create_medicine("620000004", yakka_code: "1119400A1234")
    create_hot("５ｍｇ１管", individual_medicine_code: "1119400A1234")

    described_class.call

    expect(conversions_for("620000004")).to eq([["mg", 5.0, "管", "explicit"]])
  end

  it "規格を読み取れない医薬品には行を作らない" do
    create_medicine("610000003", unit_name: "錠")
    create_hot("１錠", receipt_code_1: "610000003")
    create_medicine("610000004", unit_name: "錠")

    result = described_class.call

    expect(conversions_for("610000003")).to be_empty
    expect(conversions_for("610000004")).to be_empty
    expect(result.unmapped_count).to eq(2)
  end

  it "既に換算行を持つ医薬品はスキップして手動メンテを上書きしない" do
    create_medicine("620000005")
    create_hot("３０ｍｇ２０ｍＬ１管", receipt_code_1: "620000005")
    Master::MedicineDoseConversion.create!(
      medicine_code: "620000005", from_unit: "mg", factor: 99, to_unit: "管", source: "manual"
    )

    result = described_class.call

    expect(conversions_for("620000005")).to eq([["mg", 99.0, "管", "manual"]])
    expect(result.created_count).to be_zero
    expect(result.skipped_count).to eq(1)
  end

  it "2回目の実行では何も作らない" do
    create_medicine("620000006")
    create_hot("３０ｍｇ２０ｍＬ１管", receipt_code_1: "620000006")

    first = described_class.call
    second = described_class.call

    expect(first.created_count).to eq(2)
    expect(second.created_count).to be_zero
    expect(second.skipped_count).to eq(1)
  end

  it "薬価算定単位が医薬品マスタの単位と食い違うものに要確認を立てる" do
    create_medicine("610000005", unit_name: "錠")
    create_hot("１０ｍｇ１シート", receipt_code_1: "610000005")

    result = described_class.call

    expect(Master::MedicineDoseConversion.find_by(medicine_code: "610000005").needs_review).to be(true)
    expect(result.needs_review_count).to eq(1)
  end

  it "規格単位の容量が医薬品マスタの注射容量と食い違うものに要確認を立てる" do
    create_medicine("620000007", unit_name: "袋", injection_volume: "140")
    create_hot("血液２００ｍＬに由来する赤血球１袋", receipt_code_1: "620000007")

    described_class.call

    expect(Master::MedicineDoseConversion.find_by(medicine_code: "620000007", from_unit: "mL").needs_review)
      .to be(true)
  end

  it "注射容量が一致していれば要確認を立てない" do
    create_medicine("620000008", injection_volume: "20")
    create_hot("３０ｍｇ２０ｍＬ１管", receipt_code_1: "620000008")

    result = described_class.call

    expect(result.needs_review_count).to be_zero
  end
end
