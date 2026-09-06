require "rails_helper"

RSpec.describe MasterImport::CtcaeTermImporter do
  # 配布ファイル(CTCAEv5J_*.xlsx)から先頭の 2 用語だけを抜いたサンプル。
  # 配布物そのものはリポジトリに置かない(JCOG の利用条件。§7.6 F)。
  let(:file) { fixture_file_upload("ctcae_terms_sample.xlsx") }

  it "SOC の見出し行を飛ばして用語だけ取り込む" do
    result = described_class.call(file)

    expect(result.imported_count).to eq(2)
    expect(Master::CtcaeTerm.count).to eq(2)

    anemia = Master::CtcaeTerm.find_by(meddra_code: "10002272")
    expect(anemia.term_ja).to eq("貧血")
    expect(anemia.term_en).to eq("Anemia")
    expect(anemia.soc_ja).to eq("血液およびリンパ系障害")
    expect(anemia.grade5_ja).to eq("死亡")
    expect(anemia.available_grades).to eq([1, 2, 3, 4, 5])
  end

  it "検索用の列を埋める" do
    described_class.call(file)

    expect(Master::CtcaeTerm.find_by(term_ja: "貧血").search_term).to eq("貧血")
  end

  it "取り込みのたびに全件を入れ替える" do
    described_class.call(file)
    Master::CtcaeTerm.create!(meddra_code: "99999999", term_ja: "古い用語")

    described_class.call(fixture_file_upload("ctcae_terms_sample.xlsx"))

    expect(Master::CtcaeTerm.pluck(:meddra_code)).to contain_exactly("10002272", "10048580")
  end

  it "Excel 以外は受け付けない" do
    expect { described_class.call(fixture_file_upload("jfagy_allergens_sample.csv")) }
      .to raise_error(MasterImport::ImportError, /Excel/)
  end
end
