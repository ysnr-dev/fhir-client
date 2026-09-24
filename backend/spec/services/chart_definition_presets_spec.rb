require "rails_helper"

RSpec.describe ChartDefinitionPresets do
  before do
    Master::LabResultItem.create!(result_item_code: "160010010", name: "HbA1c", short_name: "HbA1c",
                                  display_unit: "%", data_type: "PQ", jlac11_code: "B3009000021200012")
    Master::LabResultItem.create!(result_item_code: "160194710", name: "HIV-1,2抗原・抗体同時測定定性", data_type: "CD")
    Master::Medicine.create!(medicine_code: "613330003", name: "ワーファリン錠１ｍｇ", yakka_code: "3332001F1016")
    Master::Medicine.create!(medicine_code: "620002332", name: "ワーファリン錠０．５ｍｇ", yakka_code: "3332001F3019")
  end

  def load(presets) = described_class.new(presets).load!

  it "マスタから名称・単位・coding を引いて、画面と同じ形の院内共通の定義を作る" do
    result = load([{
      "name" => "糖尿病", "axis" => { "unit" => "month", "columns" => 24 },
      "items" => [{ "lab" => "160010010" }, { "vital" => "85354-9" }],
      "drugs" => [{ "name" => "ワルファリン", "yj7" => "3332001" }],
      "events" => %w[condition encounter]
    }])

    expect(result.created).to eq(1)
    record = ChartDefinition.find_by!(scope: "facility", name: "糖尿病")
    expect(record).to be_valid
    definition = record.definition
    expect(definition["axis"]).to eq("unit" => "month", "columns" => 24)
    expect(definition["items"].first).to eq(
      "key" => "lab:160010010", "source" => "lab", "name" => "HbA1c", "unit" => "%",
      "codings" => [
        { "system" => described_class::RESULT_ITEM_SYSTEM, "code" => "160010010", "display" => "HbA1c" },
        { "system" => described_class::JLAC11_SYSTEM, "code" => "B3009000021200012" }
      ]
    )
    expect(definition["items"].second).to include("key" => "vital:85354-9", "name" => "血圧")
    expect(definition["items"].second["components"].map { |c| c["code"] }).to eq(%w[8480-6 8462-4])
    expect(definition["drugs"]).to eq([
      { "key" => "yj7:3332001", "name" => "ワルファリン", "yj7" => "3332001", "codes" => %w[613330003 620002332] }
    ])
    expect(definition["events"]).to eq(%w[condition encounter])
  end

  it "マスタに無い・数値でない検査項目は落とし、何も残らない定義は作らない" do
    result = load([
      { "name" => "糖尿病", "items" => [{ "lab" => "160010010" }, { "lab" => "999999999" }], "drugs" => [] },
      { "name" => "HIV", "items" => [{ "lab" => "160194710" }], "drugs" => [] }
    ])

    expect(result.created).to eq(1)
    expect(result.skipped_items).to contain_exactly("糖尿病: 999999999", "HIV: 160194710")
    expect(ChartDefinition.find_by!(name: "糖尿病").definition["items"].size).to eq(1)
    expect(ChartDefinition.exists?(name: "HIV")).to be(false)
  end

  it "同じ名前の院内共通の定義があれば上書きしない" do
    ChartDefinition.create!(scope: "facility", name: "糖尿病", definition: { "items" => [] })

    result = load([{ "name" => "糖尿病", "items" => [{ "lab" => "160010010" }] }])

    expect(result.kept).to eq(1)
    expect(ChartDefinition.find_by!(name: "糖尿病").definition["items"]).to eq([])
  end

  it "同梱の JSON は検証を通る形になっている" do
    presets = JSON.parse(File.read(Rails.root.join("db/seed_data/chart_definition_presets.json")))
    expect { load(presets) }.not_to raise_error
    expect(ChartDefinition.where(scope: "facility").pluck(:name)).to include("糖尿病")
  end
end
