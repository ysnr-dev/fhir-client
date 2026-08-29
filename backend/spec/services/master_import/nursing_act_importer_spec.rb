require "rails_helper"

RSpec.describe MasterImport::NursingActImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/nursing_acts_sample.txt"), "rb")
  end

  it "取り込んで 16 桁コードと有効フラグを組み立てる" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    record = Master::NursingAct.find_by(manage_no: "12000001")
    expect(record.level1_code).to eq("A001")
    expect(record.level1_name).to eq("日常生活ケア")
    expect(record.level3_name).to eq("入浴")
    expect(record.level4_name).to eq("全介助")
    expect(record.code_16).to eq("A001B001C001D001")
    expect(record.active).to be(true)
    expect(record.sort_key).to eq(2)
    expect(record.search_name).to eq(Master::SearchNormalizer.normalize("入浴全介助"))
  end

  it "変更区分 2(既削除)は active=false にする" do
    described_class.call(sample_file)

    expect(Master::NursingAct.find_by(manage_no: "12000028").active).to be(false)
    expect(Master::NursingAct.active.count).to eq(2)
  end

  it "全件洗い替えする" do
    Master::NursingAct.create!(manage_no: "stale", level1_code: "X", level2_code: "X", level3_code: "X",
                               level4_code: "X", code_16: "XXXX")

    described_class.call(sample_file)

    expect(Master::NursingAct.where(manage_no: "stale")).not_to exist
    expect(Master::NursingAct.count).to eq(3)
  end

  it "列数が違う行があれば全体をロールバックする" do
    Master::NursingAct.create!(manage_no: "kept", level1_code: "X", level2_code: "X", level3_code: "X",
                               level4_code: "X", code_16: "XXXX")

    bad_file = StringIO.new("a,b\n1,2\n")

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::NursingAct.count).to eq(1)
  end
end
