require "rails_helper"

RSpec.describe MasterImport::NursingObservationImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/nursing_observations_sample.txt"), "rb")
  end

  it "取り込んで検索列と有効フラグを埋める" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    spo2 = Master::NursingObservation.find_by(manage_no: "31000001")
    expect(spo2.name).to eq("経皮的動脈血酸素飽和度（ＳＰＯ２）")
    expect(spo2.expression_type).to eq("数値型")
    expect(spo2.unit).to eq("%")
    expect(spo2.search_category_1).to eq("1")
    expect(spo2.unit_code).to eq("U001")
    expect(spo2.active).to be(true)
    expect(spo2.search_name).to eq(Master::SearchNormalizer.normalize(spo2.name))
    expect(spo2.search_kana).to eq(Master::SearchNormalizer.normalize(spo2.kana))

    stool = Master::NursingObservation.find_by(manage_no: "31000030")
    expect(stool.results).to eq(%w[少量 中等量 多量])
    expect(stool.result_group_code).to eq("R7031")

    expect(Master::NursingObservation.find_by(manage_no: "31000017").active).to be(false)
  end
end
