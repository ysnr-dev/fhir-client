require "rails_helper"

RSpec.describe LabImport::Importer do
  def fixture(name)
    File.open(Rails.root.join("spec/fixtures/lab_import/#{name}"), "rb")
  end

  def import(name, **options)
    described_class.new(file: fixture(name), file_name: name, **options).call
  end

  before do
    Master::LabResultItem.create!(result_item_code: "L-AST", name: "AST", data_type: "PQ",
                                  jlac10_code: "3B035000002327299")
  end

  it "ORU^R01 を取り込んで台帳とバッチを作る" do
    result = import("oru_r01_utf8.hl7")
    batch = result.import

    expect(batch.message_type).to eq("ORU^R01")
    expect(batch.encoding).to eq("UTF-8")
    expect(batch.encoding_reason).to eq("msh18")
    expect(batch.file_name).to eq("oru_r01_utf8.hl7")
    expect(batch.row_count).to eq(3)
    # OBX-11 が X の行は取り込まず数だけ残す。
    expect(batch.skipped_count).to eq(1)
    expect(batch.rows.count).to eq(3)
    expect(batch.status_counts).to eq("pending" => 2, "ready" => 1)
  end

  it "引き当てた行と保留の行を区別して持つ" do
    rows = import("oru_r01_utf8.hl7").import.rows.ordered.to_a

    ast = rows.find { |row| row.external_name == "AST" }
    expect(ast.result_item_code).to eq("L-AST")
    expect(ast.resolution).to eq("jlac10_prefix")
    expect(ast.status).to eq("ready")
    expect(ast.value).to eq("50")
    expect(ast.unit).to eq("U")
    expect(ast.abnormal_flag).to eq("H")

    unknown = rows.find { |row| row.external_name == "未登録項目" }
    expect(unknown.status).to eq("pending")
    expect(unknown.pending_reason).to eq("item_unresolved")
  end

  it "文字コードの異なる同じ内容のファイルから同じ行が作れる" do
    utf8 = import("oru_r01_utf8.hl7").import.rows.ordered.pluck(:external_name)
    cp932 = import("oru_r01_cp932.hl7").import.rows.ordered.pluck(:external_name)

    expect(cp932).to eq(utf8)
    expect(LabResultImport.last.encoding).to eq("CP932")
  end

  it "OUL^R22 では検体ごとに群が分かれる" do
    batch = import("oul_r22_iso2022jp.hl7").import

    expect(batch.encoding).to eq("ISO-2022-JP")
    expect(batch.rows.ordered.pluck(:group_no)).to eq([1, 2, 3])
    expect(batch.rows.ordered.pluck(:specimen_ids))
      .to eq([["00076787001"], ["00076787001"], ["00076787002"]])
  end

  it "同じメッセージ ID のバッチがあれば知らせる(取込は止めない)" do
    first = import("oru_r01_utf8.hl7").import
    second = import("oru_r01_utf8.hl7")

    # 訂正版が同じ ID で来ることがあるので取込自体は通す。
    expect(second.import.id).not_to eq(first.id)
    expect(second.duplicate_ids).to eq([first.id])
  end

  it "結果が 1 件も無いファイルは取り込まない" do
    file = StringIO.new("MSH|^~\\&|LIS|LAB|HIS|HOSP|20260101||ORU^R01^ORU_R01|m1|P|2.5\r")
    expect { described_class.new(file: file).call }
      .to raise_error(LabImport::ImportError, /1 件もありません/)
  end

  it "対応していない形式は取り込まない" do
    expect { import("oru_r01_utf8.hl7", format: "csv") }
      .to raise_error(LabImport::ImportError, /対応していない形式/)
  end

  it "取り込んだ人を残す" do
    batch = import("oru_r01_utf8.hl7",
                   imported_by: { login_id: "ichiro", practitioner_id: "prac-1" }).import

    expect(batch.imported_by_login_id).to eq("ichiro")
    expect(batch.imported_by_practitioner_id).to eq("prac-1")
  end
end
