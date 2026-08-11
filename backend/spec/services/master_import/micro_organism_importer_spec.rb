require "rails_helper"

RSpec.describe MasterImport::MicroOrganismImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/micro_organisms_sample.xlsx"), "rb")
  end

  it "最新版のシートだけを取り込む" do
    result = described_class.call(sample_file)

    expect(result.sheet_name).to eq("Ver.6.1")
    expect(result.imported_count).to eq(3)
    # 重複行とコードが数字でない行を落とす。
    expect(result.skipped_count).to eq(2)
    expect(Master::MicroOrganism.pluck(:code)).to match_array(%w[1100 2101 9998])
    # 旧版シート(Ver.6.0)にしか無いコードは入らない。
    expect(Master::MicroOrganism.exists?(code: "9000")).to be(false)

    record = Master::MicroOrganism.find_by(code: "2101")
    expect(record.name).to eq("Staphylococcus aureus (MSSA) (β非産生)")
    expect(record.source).to eq("official")
    expect(record.display_order).to be_present
    expect(record.search_name).to be_present
  end

  it "取込のたびに official を洗い替え、local と頻用菌の印は温存する" do
    Master::MicroOrganism.create!(code: "1100", name: "前回取込分", frequent: true)
    Master::MicroOrganism.create!(code: "9000", name: "前回のみの菌")
    Master::MicroOrganism.create!(code: "0001", name: "施設追加菌", source: "local")

    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::MicroOrganism.find_by(code: "1100"))
      .to have_attributes(name: "Streptococcus sp.", frequent: true)
    expect(Master::MicroOrganism.exists?(code: "9000")).to be(false)
    expect(Master::MicroOrganism.find_by(code: "0001"))
      .to have_attributes(name: "施設追加菌", source: "local")
  end

  it "施設追加コードと重複したら取込ごと止める" do
    Master::MicroOrganism.create!(code: "1100", name: "施設追加菌", source: "local")

    expect { described_class.call(sample_file) }
      .to raise_error(MasterImport::ImportError, /1100/)
    expect(Master::MicroOrganism.count).to eq(1)
  end

  it "版(Ver.x.x)のシートが無いファイルは取り込まない" do
    file = File.open(Rails.root.join("spec/fixtures/files/micro_specimen_types_sample.xlsx"), "rb")

    expect { described_class.call(file) }.to raise_error(MasterImport::ImportError, /Ver/)
  end
end
