require "rails_helper"

RSpec.describe MasterImport::LabSpecimenImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/lab_specimens_sample.xlsx"), "rb")
  end

  it "材料コードシートの行を分類・階層・推奨フラグ付きで取り込む" do
    result = described_class.call(sample_file)

    # 更新区分 S の行(999)は取り込まない。
    expect(result.imported_count).to eq(5)
    expect(Master::LabSpecimen.pluck(:specimen_code)).to match_array(%w[100 101 510 511 250])

    urine = Master::LabSpecimen.find_by(specimen_code: "100")
    expect(urine.name).to eq("尿")
    expect(urine.category).to eq("尿・便")
    expect(urine.parent_specimen_code).to be_nil
    expect(urine.recommended).to be(true)
    expect(urine.jlac10_specimen_code).to eq("001")

    child = Master::LabSpecimen.find_by(specimen_code: "101")
    expect(child.name).to eq("自然排尿")
    expect(child.parent_specimen_code).to eq("100")
    expect(child.recommended).to be(false)

    # 字下げ2段の行は、直近の浅い行が親になる。
    lung = Master::LabSpecimen.find_by(specimen_code: "511")
    expect(lung.name).to eq("生検材料(肺)")
    expect(lung.parent_specimen_code).to eq("510")
    expect(lung.category).to eq("組織")

    # セルのルビをカナ名称として取り込み、検索用カラムにも反映する。
    expect(lung.name_kana).to eq("セイケンザイリョウハイ")
    expect(lung.search_kana).to eq("セイケンザイリョウハイ")

    # 掲載順を display_order に保存する。
    orders = Master::LabSpecimen.order(:display_order).pluck(:specimen_code)
    expect(orders).to eq(%w[100 101 510 511 250])
  end

  it "再取込は配布ファイル由来の列だけを更新し、手入力の列を保全する" do
    described_class.call(sample_file)
    serum = Master::LabSpecimen.find_by(specimen_code: "250")
    serum.update!(short_name: "血清S", default_container_code: "T01", note: "手入力メモ", name: "古い名称")

    described_class.call(sample_file)

    serum.reload
    expect(serum.name).to eq("血清")
    expect(serum.short_name).to eq("血清S")
    expect(serum.default_container_code).to eq("T01")
    expect(serum.note).to eq("手入力メモ")
  end

  it "手動追加した検体(ファイルに無いコード)を消さない" do
    Master::LabSpecimen.create!(specimen_code: "800", name: "院内独自検体")

    described_class.call(sample_file)

    expect(Master::LabSpecimen.find_by(specimen_code: "800")).to be_present
  end

  it "材料コードシートが無いファイルは ImportError にする" do
    file = File.open(Rails.root.join("spec/fixtures/files/medicine_usages_sample.xlsx"), "rb")

    expect { described_class.call(file) }.to raise_error(MasterImport::ImportError, /材料コード/)
  end
end
