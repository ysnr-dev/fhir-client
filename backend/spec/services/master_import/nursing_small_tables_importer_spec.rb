require "rails_helper"

RSpec.describe "看護観察編の付属テーブル取込" do
  def fixture(name)
    File.open(Rails.root.join("spec/fixtures/files/#{name}"), "rb")
  end

  it "観察結果テーブルを取り込む" do
    result = MasterImport::NursingObservationResultImporter.call(fixture("nursing_observation_results_sample.txt"))

    expect(result.imported_count).to eq(3)
    expect(Master::NursingObservationResult.find_by(result_group_code: "R1001", result_code: "01").name).to end_with("３")
  end

  it "単位テーブルを取り込む" do
    result = MasterImport::NursingUnitImporter.call(fixture("nursing_units_sample.txt"))

    expect(result.imported_count).to eq(3)
    expect(Master::NursingUnit.find_by(unit_code: "U003").name).to eq("℃")
  end
end
