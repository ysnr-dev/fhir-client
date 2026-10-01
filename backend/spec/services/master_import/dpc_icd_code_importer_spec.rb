require "rails_helper"

RSpec.describe MasterImport::DpcIcdCodeImporter do
  # 厚生労働省の DPC 電子点数表と同じシート構成(「４）ＩＣＤ」・ヘッダー2行)で
  # 11 行だけ持つ自作のサンプル。
  let(:file) { fixture_file_upload("dpc_icd_codes_sample.xlsx") }

  it "「４）ＩＣＤ」シートをヘッダー2行を飛ばして取り込む" do
    result = described_class.call(file)

    expect(result.imported_count).to eq(11)
    expect(Master::DpcIcdCode.count).to eq(11)

    record = Master::DpcIcdCode.find_by(icd_pattern: "C700")
    expect(record.mdc6).to eq("010010")
    expect(record.icd10).to eq("C700")
    expect(record.match_type).to eq("exact")
    expect(record.icd_name).to eq("髄膜の悪性新生物＜腫瘍＞，脳髄膜")
    expect(record.valid_from).to eq("20260601")
    expect(record.valid_to).to eq("99999999")
  end

  it "末尾が $ のコードは記号を外して前方一致にする" do
    described_class.call(file)

    expect(Master::DpcIcdCode.find_by(icd_pattern: "I50$"))
      .to have_attributes(mdc6: "050130", icd10: "I50", match_type: "prefix")
    expect(Master::DpcIcdCode.find_by(icd_pattern: "I700$"))
      .to have_attributes(mdc6: "050170", icd10: "I700", match_type: "prefix")
  end

  it "末尾が x の分類コードもそのまま取り込む" do
    described_class.call(file)

    expect(Master::DpcIcdCode.find_by(icd_pattern: "F00$").mdc6).to eq("01021x")
  end

  it "「M!!!!」は表に無いコードの受け皿にする" do
    described_class.call(file)

    expect(Master::DpcIcdCode.find_by(icd_pattern: "M!!!!"))
      .to have_attributes(mdc6: "071030", icd10: "M", match_type: "fallback")
  end

  it "取り込みのたびに全件を入れ替える" do
    described_class.call(file)
    Master::DpcIcdCode.create!(mdc6: "999999", icd10: "Z999", icd_pattern: "Z999", match_type: "exact")

    described_class.call(fixture_file_upload("dpc_icd_codes_sample.xlsx"))

    expect(Master::DpcIcdCode.count).to eq(11)
    expect(Master::DpcIcdCode.where(mdc6: "999999")).to be_empty
  end

  it "ICD のシートが無い Excel は受け付けない" do
    expect { described_class.call(fixture_file_upload("ctcae_terms_sample.xlsx")) }
      .to raise_error(MasterImport::ImportError, /ＩＣＤ/)
    expect(Master::DpcIcdCode.count).to eq(0)
  end

  it "Excel 以外は受け付けない" do
    expect { described_class.call(fixture_file_upload("jfagy_allergens_sample.csv")) }
      .to raise_error(MasterImport::ImportError, /Excel/)
  end
end
