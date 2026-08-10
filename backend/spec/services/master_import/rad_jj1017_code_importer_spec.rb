require "rails_helper"

RSpec.describe MasterImport::RadJj1017CodeImporter do
  def procedures_file
    File.open(Rails.root.join("spec/fixtures/files/rad_jj1017_codes_sample.xlsx"), "rb")
  end

  def body_parts_file
    File.open(Rails.root.join("spec/fixtures/files/rad_jj1017_body_parts_sample.xls"), "rb")
  end

  describe "別表A(手技)" do
    it "シートごとに要素を振り分けて取り込む" do
      result = described_class.call(procedures_file)

      expect(result.element_counts).to eq(
        "procedure_major" => 4, "procedure_minor" => 3, "procedure_extension" => 1
      )
      expect(result.imported_count).to eq(8)
      # コード意味が空の欠番行は取り込まず、スキップとして数える。
      expect(result.skipped_count).to eq(1)
      expect(Master::RadJj1017Code.where(element: "procedure_major").pluck(:code))
        .to match_array(%w[00 21 1A B1])
    end

    it "コード意味・英語名・Ver・掲載順を取り込む" do
      described_class.call(procedures_file)

      record = Master::RadJj1017Code.find_by(element: "procedure_major", code: "1A")
      expect(record.name).to eq("Ｘ線ＣＴ")
      expect(record.name_english).to eq("CT")
      expect(record.jj_version).to eq("3.2")
      expect(record.display_order).to eq(4)
      expect(record.source).to eq("official")
    end

    it "補語の列はコード意味に連結する" do
      described_class.call(procedures_file)

      expect(Master::RadJj1017Code.find_by(element: "procedure_major", code: "21").name)
        .to eq("健診・人間ドック関連の手技")
    end

    it "通称名称(核医学領域頻用名)を取り込み、検索用カラムにも入れる" do
      described_class.call(procedures_file)

      record = Master::RadJj1017Code.find_by(element: "procedure_extension", code: "J0")
      expect(record.common_name).to eq("11C-酢酸")
      expect(record.search_name).to include("11c-酢酸")
    end

    it "数値セルになっているコード値は桁数まで0で戻す" do
      described_class.call(procedures_file)

      # Excel 上は数値の 2。手技(小分類)は2桁なので "02"。
      expect(Master::RadJj1017Code.where(element: "procedure_minor").pluck(:code))
        .to match_array(%w[00 01 02])
    end
  end

  describe "別表B(部位)" do
    it "大部位・臓器系部位・モダリティ別の使用可否を取り込む" do
      result = described_class.call(body_parts_file)

      expect(result.element_counts).to eq("body_part" => 3)

      head = Master::RadJj1017Code.find_by(element: "body_part", code: "100")
      expect(head.name).to eq("頭部")
      expect(head.name_english).to eq("HEAD")
      expect(head.major_part_code).to eq("55")
      expect(head.organ_system_code).to eq("1")
      expect([head.use_general, head.use_ct, head.use_mr, head.use_us]).to eq([true, true, true, false])

      chest = Master::RadJj1017Code.find_by(element: "body_part", code: "200")
      expect([chest.use_general, chest.use_ct, chest.use_mr, chest.use_us])
        .to eq([true, true, false, true])
    end

    it "同じ内容の簡易版である「C部位」シートは読まない" do
      described_class.call(body_parts_file)

      expect(Master::RadJj1017Code.exists?(element: "body_part", code: "999")).to be(false)
    end
  end

  describe "洗い替えの範囲" do
    it "ファイルに含まれていた要素だけを洗い替える" do
      # 別表に無い要素(種別・左右等)は seeds から入るので、取込で消してはいけない。
      Master::RadJj1017Code.create!(element: "modality", code: "1", name: "Ｘ線単純撮影")
      described_class.call(procedures_file)

      expect(Master::RadJj1017Code.exists?(element: "modality", code: "1")).to be(true)
    end

    it "同じ要素の標準コードは入れ替える" do
      Master::RadJj1017Code.create!(element: "procedure_major", code: "99", name: "前回の取込分")
      described_class.call(procedures_file)

      expect(Master::RadJj1017Code.exists?(element: "procedure_major", code: "99")).to be(false)
    end

    it "施設拡張コードは洗い替えの対象外で残る" do
      Master::RadJj1017Code.create!(element: "procedure_major", code: "C1", name: "院内独自手技",
                                    source: "local")
      described_class.call(procedures_file)

      expect(Master::RadJj1017Code.find_by(element: "procedure_major", code: "C1").source).to eq("local")
    end

    it "施設拡張コードと同じコードが配布ファイルに載っていたら取り込まない" do
      # 施設が拡張の帯に作ったコードを、後の版で JJ1017 側が標準コードに使った場合。
      Master::RadJj1017Code.create!(element: "procedure_major", code: "B1", name: "院内独自手技",
                                    source: "local")

      expect { described_class.call(procedures_file) }
        .to raise_error(MasterImport::ImportError, /施設拡張コードと重複/)
      # 取り込みかけの状態を残さない。
      expect(Master::RadJj1017Code.count).to eq(1)
    end
  end

  it "Excel でないファイルは取り込まない" do
    expect { described_class.call(File.open(Rails.root.join("spec/fixtures/files/medicines_sample.csv"))) }
      .to raise_error(MasterImport::ImportError, /Excel/)
  end

  it "JJ1017 の別表シートが1つも無いファイルは取り込まない" do
    file = File.open(Rails.root.join("spec/fixtures/files/lab_specimens_sample.xlsx"), "rb")

    expect { described_class.call(file) }.to raise_error(MasterImport::ImportError, /別表/)
  end
end
