require "rails_helper"

# 取込元コード対応表は持たず、JLAC10 / JLAC11 を正本に引き当てる。
# 当たらない行・複数当たった行は保留にして取込画面で人が決める。
RSpec.describe LabImport::ItemResolver do
  def row(attrs = {})
    { jlac10_code: nil, jlac11_code: nil, value: "1.0", value_text: nil,
      resolution: nil, external_code: "X" }.merge(attrs)
  end

  def create_item(code, attrs = {})
    Master::LabResultItem.create!({ result_item_code: code, name: code, data_type: "PQ" }.merge(attrs))
  end

  it "JLAC10 の完全一致で引き当てる" do
    create_item("L001", jlac10_code: "3B035000002327201")
    target = row(jlac10_code: "3B035000002327201")

    described_class.new.resolve_all([target])

    expect(target[:result_item_code]).to eq("L001")
    expect(target[:resolution]).to eq("jlac10")
    expect(target[:status]).to eq("ready")
  end

  it "JLAC11 の完全一致で引き当てる" do
    create_item("L002", jlac11_code: "3B035000002327201")
    target = row(jlac11_code: "3B035000002327201")

    described_class.new.resolve_all([target])

    expect(target[:result_item_code]).to eq("L002")
    expect(target[:resolution]).to eq("jlac11")
  end

  it "17 桁のコードは先頭 12 桁でも引き当てる" do
    # 試薬・機器単位のコードは下 5 桁(測定法・結果識別)がマスタの代表コードと違う。
    create_item("L003", jlac10_code: "3B035000002399999")
    target = row(jlac10_code: "3B035000002327201")

    described_class.new.resolve_all([target])

    expect(target[:result_item_code]).to eq("L003")
    expect(target[:resolution]).to eq("jlac10_prefix")
  end

  it "前方一致で複数当たったら先勝ちさせず候補を残して保留にする" do
    create_item("L004", jlac10_code: "3B035000002311111", display_order: 1)
    create_item("L005", jlac10_code: "3B035000002322222", display_order: 2)
    target = row(jlac10_code: "3B035000002327201")

    described_class.new.resolve_all([target])

    expect(target[:result_item_code]).to be_nil
    expect(target[:status]).to eq("pending")
    expect(target[:pending_reason]).to eq("item_ambiguous")
    expect(target[:candidate_item_codes]).to contain_exactly("L004", "L005")
  end

  it "有効期間の外の項目には当てない" do
    create_item("L006", jlac10_code: "3B035000002327201", valid_to: Date.current - 1)
    target = row(jlac10_code: "3B035000002327201")

    described_class.new.resolve_all([target])

    expect(target[:status]).to eq("pending")
    expect(target[:pending_reason]).to eq("item_unresolved")
  end

  it "どのコードにも当たらない行は保留にする" do
    target = row(jlac10_code: "9Z999999999999999")

    described_class.new.resolve_all([target])

    expect(target[:status]).to eq("pending")
    expect(target[:pending_reason]).to eq("item_unresolved")
  end

  describe "値の検証" do
    it "コード型は選択肢のコードに照合し、値をコードに正規化する" do
      create_item("L010", jlac10_code: "5C000000000000001", data_type: "CO",
                          code_value_list: "1：(-)、2：(±)、3：(1+)")
      target = row(jlac10_code: "5C000000000000001", value: "2")

      described_class.new.resolve_all([target])

      expect(target[:status]).to eq("ready")
      expect(target[:value]).to eq("2")
    end

    it "コード型は表示名からでも引き当てる" do
      create_item("L011", jlac10_code: "5C000000000000002", data_type: "CD",
                          code_value_list: "1：陽性、2：陰性")
      target = row(jlac10_code: "5C000000000000002", value: "陰性")

      described_class.new.resolve_all([target])

      expect(target[:value]).to eq("2")
      expect(target[:status]).to eq("ready")
    end

    it "選択肢に無い値は結果項目を保ったまま保留にする" do
      create_item("L012", jlac10_code: "5C000000000000003", data_type: "CO",
                          code_value_list: "1：(-)、2：(±)")
      target = row(jlac10_code: "5C000000000000003", value: "9")

      described_class.new.resolve_all([target])

      expect(target[:result_item_code]).to eq("L012")
      expect(target[:status]).to eq("pending")
      expect(target[:pending_reason]).to eq("value_unmatched")
    end

    it "数値項目に数値でない値が来たら保留にする" do
      # そのまま登録すると valueQuantity が NaN になる。
      create_item("L013", jlac10_code: "3C000000000000001")
      target = row(jlac10_code: "3C000000000000001", value: "<5")

      described_class.new.resolve_all([target])

      expect(target[:result_item_code]).to eq("L013")
      expect(target[:status]).to eq("pending")
      expect(target[:pending_reason]).to eq("value_not_numeric")
    end

    it "文字列型はそのまま登録待ちにする" do
      create_item("L014", jlac10_code: "3C000000000000002", data_type: "ST")
      target = row(jlac10_code: "3C000000000000002", value: "検出せず")

      described_class.new.resolve_all([target])

      expect(target[:status]).to eq("ready")
    end
  end

  it "行が ActiveRecord でも扱える(再引き当て)" do
    create_item("L020", jlac10_code: "3B035000002327201")
    import = LabResultImport.create!(format: "hl7_v25")
    record = import.rows.create!(group_no: 1, sequence: 1, jlac10_code: "3B035000002327201",
                                 value: "5.0", status: "pending", pending_reason: "item_unresolved")

    described_class.new.resolve_all([record])

    expect(record.result_item_code).to eq("L020")
    expect(record.status).to eq("ready")
  end
end
