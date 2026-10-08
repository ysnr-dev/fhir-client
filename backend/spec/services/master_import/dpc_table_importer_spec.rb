require "rails_helper"

RSpec.describe MasterImport::DpcTableImporter do
  # 令和8年度版の DPC 電子点数表から、いくつかの診断群分類(060035・060330・040080・010060・
  # 060350・071030・050130)の行だけを抜き出したもの。作り方は docs/dpc-coding-design.md。
  let(:file) { fixture_file_upload("dpc_tables_sample.xlsx") }

  it "全シートを版(改定の開始日)付きで取り込む" do
    result = described_class.call(file)

    expect(result.elements).to include("MDC" => 18, "分類名称" => 7, "診断群分類点数表" => 247, "変換テーブル" => 641)
    expect(Master::DpcEdition.pluck(:edition)).to eq(["20260601"])
    expect(Master::DpcEdition.first.counts).to include("conversion" => 641)
    expect(Master::DpcClassification.find_by(code: "060035").name).to eq("結腸（虫垂を含む。）の悪性腫瘍")
  end

  it "ICD-10 → 診断群分類の対応を表記ごとの照合方法で持つ" do
    described_class.call(file)

    expect(Master::DpcIcdCode.find_by(icd_pattern: "I50$"))
      .to have_attributes(mdc6: "050130", icd10: "I50", match_type: "prefix", edition: "20260601")
    expect(Master::DpcIcdCode.find_by(icd_pattern: "M!!!!"))
      .to have_attributes(mdc6: "071030", icd10: "M", match_type: "fallback")
  end

  it "手術は手術1〜5 のコードの組と、手術フラグ・対応コードを持つ" do
    described_class.call(file)

    row = Master::DpcSurgery.where(mdc6: "060330").find_by("codes = ?::jsonb", ["K672-2"].to_json)
    expect(row).to have_attributes(flag: "02", code_value: "02")
    expect(Master::DpcSurgery.where(mdc6: "060035").pluck(:flag)).to include("99", "97")
  end

  it "処置等1 は手術との組み合わせ条件を、処置等2 は薬剤の 4 桁コードを持つ" do
    described_class.call(file)

    drug = Master::DpcProcedure.where(mdc6: "060035", kind: 2).find_by("codes = ?::jsonb", ["0156"].to_json)
    expect(drug).to be_present
    expect(drug.names).to eq(["オキサリプラチン"])
    expect(Master::DpcProcedure.where(kind: 1).count).to eq(37)
  end

  it "点数表の「-」と空欄は持たず、包括対象外の分類も行は残す" do
    described_class.call(file)

    expect(Master::DpcPoint.find_by(dpc_code: "060035xx99x4xx"))
      .to have_attributes(days1: 2, days2: 3, days3: 30, points1: 3713, points2: 2694, points3: 2140)
    expect(Master::DpcConversion.find_by(dpc_code: "060035xx99x4xx").bundled).to be(true)
  end

  it "変換テーブルの分岐の値を見出しのキーで持つ" do
    described_class.call(file)

    # 14 桁の x(分岐しない桁)は、変換テーブルでは値ごとの行に展開されている。
    rows = Master::DpcConversion.where(dpc_code: "060330xx02xxxx").map(&:branch_values)
    expect(rows).to contain_exactly(
      { "surgery" => "02", "proc1" => "0", "proc2" => "0", "comorbidity" => "0" },
      { "surgery" => "02", "proc1" => "0", "proc2" => "1", "comorbidity" => "0" }
    )
  end

  it "重症度の範囲と区分を条件区分ごとに持つ" do
    described_class.call(file)

    pancreatitis = Master::DpcCondition.where(mdc6: "060350", sheet: "10-3").order(:condition_kind)
    expect(pancreatitis.pluck(:condition_kind)).to eq(%w[10 9])
    expect(pancreatitis.find_by(condition_kind: "9").ranges.first).to eq("min" => 0, "max" => 2, "value" => "0")
    expect(Master::DpcCondition.where(mdc6: "010060", sheet: "10-4").pluck(:category, :code_value))
      .to include(%w[1 3], %w[4 0])
  end

  it "出来高算定手術等コードを区分(手術・検査・患者・薬剤)ごとに取り込む" do
    described_class.call(file)

    expect(Master::DpcFeeForServiceCode.distinct.pluck(:kind)).to contain_exactly("surgery", "test", "patient", "drug")
  end

  it "同じ版を取り込み直すとその版の行だけを入れ替え、別の版は残す" do
    described_class.call(file)
    Master::DpcPoint.create!(edition: "20240601", dpc_code: "060035xx99x4xx", points1: 1)
    Master::DpcPoint.create!(edition: "20260601", dpc_code: "999999xx99x4xx")

    described_class.call(fixture_file_upload("dpc_tables_sample.xlsx"))

    expect(Master::DpcPoint.where(edition: "20240601").count).to eq(1)
    expect(Master::DpcPoint.where(dpc_code: "999999xx99x4xx")).to be_empty
    expect(Master::DpcPoint.where(edition: "20260601").count).to eq(247)
  end

  it "DPC 電子点数表でない Excel は受け付けない" do
    expect { described_class.call(fixture_file_upload("ctcae_terms_sample.xlsx")) }
      .to raise_error(MasterImport::ImportError, /シートが見つかりません/)
    expect(Master::DpcEdition.count).to eq(0)
  end

  it "Excel 以外は受け付けない" do
    expect { described_class.call(fixture_file_upload("jfagy_allergens_sample.csv")) }
      .to raise_error(MasterImport::ImportError, /Excel/)
  end
end
