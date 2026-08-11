require "rails_helper"

RSpec.describe MasterImport::MicroSpecimenTypeImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/micro_specimen_types_sample.xlsx"), "rb")
  end

  it "系統を引き継いで取り込む" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(4)
    # 名称の無い行を落とす。
    expect(result.skipped_count).to eq(1)
    expect(Master::MicroSpecimenType.find_by(code: "101"))
      .to have_attributes(name: "喀出痰", category: "口腔・気道・呼吸器", source: "official")
    # 系統が空欄の行は直前の系統を引き継ぐ。
    expect(Master::MicroSpecimenType.find_by(code: "102"))
      .to have_attributes(name: "気管内採痰", category: "口腔・気道・呼吸器")
    # 数値セル(Float)のコードも文字列に畳む。
    expect(Master::MicroSpecimenType.find_by(code: "203"))
      .to have_attributes(name: "留置カテ－テル尿", category: "泌尿器・生殖器")
    expect(Master::MicroSpecimenType.find_by(code: "101").search_name).to be_present
  end

  it "取込のたびに official を洗い替え、local は温存する" do
    Master::MicroSpecimenType.create!(code: "101", name: "前回取込分")
    Master::MicroSpecimenType.create!(code: "998", name: "施設追加材料", source: "local")

    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(4)
    expect(Master::MicroSpecimenType.find_by(code: "101").name).to eq("喀出痰")
    expect(Master::MicroSpecimenType.find_by(code: "998"))
      .to have_attributes(name: "施設追加材料", source: "local")
  end

  it "施設追加コードと重複したら取込ごと止める" do
    Master::MicroSpecimenType.create!(code: "101", name: "施設追加材料", source: "local")

    expect { described_class.call(sample_file) }
      .to raise_error(MasterImport::ImportError, /101/)
    expect(Master::MicroSpecimenType.count).to eq(1)
  end

  it "「検査材料名」の見出しが無いファイルは取り込まない" do
    file = File.open(Rails.root.join("spec/fixtures/files/micro_organisms_sample.xlsx"), "rb")

    expect { described_class.call(file) }.to raise_error(MasterImport::ImportError, /検査材料名/)
  end
end
