require "rails_helper"

RSpec.describe MasterImport::MicroSusceptibilityMethodImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/micro_susceptibility_methods_sample.xlsx"), "rb")
  end

  it "最新版のシートだけを取り込む" do
    result = described_class.call(sample_file)

    expect(result.sheet_name).to eq("Ver.4.0")
    expect(result.imported_count).to eq(4)
    # 重複行とコードが数字でない行を落とす。
    expect(result.skipped_count).to eq(2)
    expect(Master::MicroSusceptibilityMethod.pluck(:code)).to match_array(%w[11 31 39 99])
    # 旧版シート(Ver.3.0)にしか無いコードは入らない。
    expect(Master::MicroSusceptibilityMethod.exists?(code: "90")).to be(false)

    auto = Master::MicroSusceptibilityMethod.find_by(code: "11")
    expect(auto.name).to eq("微量液体希釈法")
    # 分類は見出しセルが空の列(「方法」の右隣)から読む。
    expect(auto.classification).to eq("自動化機器")
    expect(auto.product_name).to eq("マイクロスキャン・ウォーカーウェイ")
    expect(auto.company).to eq("ベックマン・コールター")
    expect(auto.source).to eq("official")
    expect(auto.display_order).to be_present
    expect(auto.search_name).to be_present

    expect(Master::MicroSusceptibilityMethod.find_by(code: "31").classification).to eq("用手法")
    expect(Master::MicroSusceptibilityMethod.find_by(code: "39").classification).to be_nil
  end

  it "取込のたびに official を洗い替え、local は温存する" do
    Master::MicroSusceptibilityMethod.create!(code: "11", name: "前回取込分")
    Master::MicroSusceptibilityMethod.create!(code: "90", name: "前回のみの方法")
    Master::MicroSusceptibilityMethod.create!(code: "01", name: "施設追加方法", source: "local")

    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(4)
    expect(Master::MicroSusceptibilityMethod.find_by(code: "11").name).to eq("微量液体希釈法")
    expect(Master::MicroSusceptibilityMethod.exists?(code: "90")).to be(false)
    expect(Master::MicroSusceptibilityMethod.find_by(code: "01"))
      .to have_attributes(name: "施設追加方法", source: "local")
  end

  it "施設追加コードと重複したら取込ごと止める" do
    Master::MicroSusceptibilityMethod.create!(code: "11", name: "施設追加方法", source: "local")

    expect { described_class.call(sample_file) }
      .to raise_error(MasterImport::ImportError, /11/)
    expect(Master::MicroSusceptibilityMethod.count).to eq(1)
  end

  it "版(Ver.x.x)のシートが無いファイルは取り込まない" do
    file = File.open(Rails.root.join("spec/fixtures/files/micro_specimen_types_sample.xlsx"), "rb")

    expect { described_class.call(file) }.to raise_error(MasterImport::ImportError, /Ver/)
  end
end
