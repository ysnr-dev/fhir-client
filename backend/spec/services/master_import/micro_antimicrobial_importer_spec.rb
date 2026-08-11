require "rails_helper"

RSpec.describe MasterImport::MicroAntimicrobialImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/micro_antimicrobials_sample.xlsx"), "rb")
  end

  it "「一覧」シートの薬剤行だけを取り込み、系統見出しを category にする" do
    result = described_class.call(sample_file)

    expect(result.sheet_name).to eq("抗菌薬コード一覧")
    expect(result.imported_count).to eq(3)
    # 重複行とコードが数字でない行を落とす(系統見出し行は skip に数えない)。
    expect(result.skipped_count).to eq(2)
    expect(Master::MicroAntimicrobial.pluck(:code)).to match_array(%w[1201 1216 2301])
    # 「全バージョン」シートのコードは入らない。
    expect(Master::MicroAntimicrobial.exists?(code: "9999")).to be(false)
    # 系統見出し行(1200 ペニシリン系)は薬剤としては保存しない。
    expect(Master::MicroAntimicrobial.exists?(code: "1200")).to be(false)

    pcg = Master::MicroAntimicrobial.find_by(code: "1201")
    expect(pcg.name).to eq("ベンジルペニシリン")
    expect(pcg.abbreviation).to eq("PCG")
    expect(pcg.brand_name).to eq("注射用ペニシリンGカリウム")
    expect(pcg.category).to eq("ペニシリン系")
    expect(pcg.source).to eq("official")
    expect(pcg.display_order).to be_present
    expect(pcg.search_name).to be_present
    expect(pcg.search_abbreviation).to be_present

    # 半角スペース字下げの薬剤行も、見出しではなく薬剤として読む。
    expect(Master::MicroAntimicrobial.find_by(code: "1216"))
      .to have_attributes(name: "アンピシリン", category: "ペニシリン系")
    # 見出しが変わると後続の category も変わる。
    expect(Master::MicroAntimicrobial.find_by(code: "2301").category)
      .to eq("グリコペプチド系/ペプチド系/リポペプチド系")
  end

  it "取込のたびに official を洗い替え、local と頻用薬の印は温存する" do
    Master::MicroAntimicrobial.create!(code: "1201", name: "前回取込分", frequent: true)
    Master::MicroAntimicrobial.create!(code: "9000", name: "前回のみの薬")
    Master::MicroAntimicrobial.create!(code: "0001", name: "施設追加薬", source: "local")

    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::MicroAntimicrobial.find_by(code: "1201"))
      .to have_attributes(name: "ベンジルペニシリン", frequent: true)
    expect(Master::MicroAntimicrobial.exists?(code: "9000")).to be(false)
    expect(Master::MicroAntimicrobial.find_by(code: "0001"))
      .to have_attributes(name: "施設追加薬", source: "local")
  end

  it "施設追加コードと重複したら取込ごと止める" do
    Master::MicroAntimicrobial.create!(code: "1201", name: "施設追加薬", source: "local")

    expect { described_class.call(sample_file) }
      .to raise_error(MasterImport::ImportError, /1201/)
    expect(Master::MicroAntimicrobial.count).to eq(1)
  end

  it "「一覧」シートが無いファイルは取り込まない" do
    file = File.open(Rails.root.join("spec/fixtures/files/micro_organisms_sample.xlsx"), "rb")

    expect { described_class.call(file) }.to raise_error(MasterImport::ImportError, /一覧/)
  end
end
