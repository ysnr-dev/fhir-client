require "rails_helper"

RSpec.describe MasterImport::RadFrequentCodeImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/rad_frequent_codes_sample.xls"), "rb")
  end

  it "シートごとに区分を振り分けて取り込む" do
    result = described_class.call(sample_file)

    expect(result.category_counts).to eq("rad_exam" => 2, "ultrasound" => 1)
    expect(result.imported_count).to eq(3)
    # 重複行と32桁でない行を落とす。
    expect(result.skipped_count).to eq(2)

    record = Master::RadJj1017FrequentCode.find_by(jj1017_code: "10000002000101000003010000000000")
    expect(record.category).to eq("rad_exam")
    expect(record.name).to eq("Ｘ線単純撮影胸部立位正面(指定無し)頸部を含めて撮影")
    expect(record.display_order).to eq(1)
    expect(record.search_name).to be_present
  end

  it "32桁コードを要素に分解できる" do
    described_class.call(sample_file)

    record = Master::RadJj1017FrequentCode.find_by(jj1017_code: "10000002000101000003010000000000")
    expect(record.elements).to eq(
      "modality" => "1",
      "body_part" => "200",
      "body_position" => "1",
      "direction" => "01",
      "special_instruction" => "03",
      "nuclide" => "01"
    )
  end

  it "取込のたびに全件洗い替える" do
    Master::RadJj1017FrequentCode.create!(category: "rad_exam", name: "前回の取込分",
                                          jj1017_code: "9" * 32)
    described_class.call(sample_file)

    expect(Master::RadJj1017FrequentCode.exists?(jj1017_code: "9" * 32)).to be(false)
    expect(Master::RadJj1017FrequentCode.count).to eq(3)
  end

  it "別表F のシートが無いファイルは取り込まない" do
    file = File.open(Rails.root.join("spec/fixtures/files/rad_jj1017_body_parts_sample.xls"), "rb")

    expect { described_class.call(file) }.to raise_error(MasterImport::ImportError, /別表F/)
  end
end
