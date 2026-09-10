require "rails_helper"

RSpec.describe Master::LabResultItemDerivation do
  def create_order_item(code, overrides = {})
    Master::LabOrderItem.create!({ order_item_code: code, name: "項目#{code}" }.merge(overrides))
  end

  # 同梱 CSV の代わりに小さな CSV を差し込む。
  def with_csv(items:, mappings:)
    Dir.mktmpdir do |dir|
      items_path = File.join(dir, "items.csv")
      mappings_path = File.join(dir, "mappings.csv")
      File.write(items_path, items)
      File.write(mappings_path, mappings)
      yield items_path, mappings_path
    end
  end

  let(:no_csv) { { items_csv: "/nonexistent/items.csv", mappings_csv: "/nonexistent/mappings.csv" } }

  it "単項目オーダー項目から同じコードの結果項目を作って 1:1 で対応づける(パネルは対象外)" do
    create_order_item("O0001", name: "白血球数", short_name: "WBC", name_kana: "ハッケッキュウスウ",
                      category: "血液学的検査", specimen_code: "211", display_order: 10)
    create_order_item("P0001", name: "末梢血液一般検査", kind: "panel")

    result = described_class.call(**no_csv)

    expect(result.created).to eq(1)
    expect(result.mapped).to eq(1)
    item = Master::LabResultItem.find_by!(result_item_code: "O0001")
    expect(item).to have_attributes(name: "白血球数", short_name: "WBC", name_kana: "ハッケッキュウスウ",
                                    category: "血液学的検査", specimen_code: "211", data_type: "PQ",
                                    display_order: 10)
    expect(Master::LabOrderItemResult.where(order_item_code: "O0001").pluck(:result_item_code)).to eq(%w[O0001])
    expect(Master::LabResultItem.exists?(result_item_code: "P0001")).to be(false)
  end

  it "JLAC11 付きの項目は配布マスタからデータ型・単位・選択肢を写し、材料コードを 17 桁から切り出す" do
    Master::LabItem.create!(jlac11_code: "V2010000025000002", jlac10_code: "5F016130023011101",
                            fhir_item_name: "HBs抗原", abbreviation: "HBsAg", data_type: "CO",
                            code_value_list: "1：陰性、2：陽性", code_oid: "urn:oid:1.2.3")
    Master::LabItem.create!(jlac11_code: "E3019000025001385", fhir_item_name: "CRP", data_type: "PQ",
                            display_unit: "mg/dL", xml_unit: "mg/dL")
    create_order_item("O0001", name: "HBs抗原定性", jlac_code: "V2010000025000002", jlac_code_system: "jlac11")
    create_order_item("O0002", name: "CRP", specimen_code: "019", jlac_code: "E3019000025001385",
                      jlac_code_system: "jlac11")

    described_class.call(**no_csv)

    hbs = Master::LabResultItem.find_by!(result_item_code: "O0001")
    expect(hbs).to have_attributes(data_type: "CO", code_value_list: "1：陰性、2：陽性",
                                   value_code_system: "urn:oid:1.2.3", short_name: "HBsAg",
                                   jlac11_code: "V2010000025000002", jlac10_code: "5F016130023011101",
                                   specimen_code: "250")
    crp = Master::LabResultItem.find_by!(result_item_code: "O0002")
    expect(crp).to have_attributes(data_type: "PQ", display_unit: "mg/dL", ucum_unit: "mg/dL",
                                   specimen_code: "019")
  end

  it "JLAC10 の引き当ては収載順で先に来た配布マスタを採る" do
    Master::LabItem.create!(jlac11_code: "A0001000010000001", jlac10_code: "1A010000001000001", data_type: "PQ",
                            display_unit: "g/dL")
    Master::LabItem.create!(jlac11_code: "A0001000010000002", jlac10_code: "1A010000001000001", data_type: "ST")
    create_order_item("O0001", name: "尿蛋白", jlac_code: "1A010000001000001", jlac_code_system: "jlac10")

    described_class.call(**no_csv)

    expect(Master::LabResultItem.find_by!(result_item_code: "O0001"))
      .to have_attributes(jlac10_code: "1A010000001000001", jlac11_code: nil, data_type: "PQ", display_unit: "g/dL")
  end

  it "再実行しても既存の結果項目・対応表を上書きしない" do
    create_order_item("O0001", name: "白血球数")
    described_class.call(**no_csv)
    Master::LabResultItem.find_by!(result_item_code: "O0001").update!(name: "施設で直した名称")

    result = described_class.call(**no_csv)

    expect(result).to have_attributes(created: 0, mapped: 0, kept: 1)
    expect(Master::LabResultItem.find_by!(result_item_code: "O0001").name).to eq("施設で直した名称")
    expect(Master::LabOrderItemResult.count).to eq(1)
  end

  it "CSV で対応づいたオーダー項目には 1:1 の placeholder を作らない" do
    create_order_item("O0001", name: "血液ガス分析", specimen_code: "223")
    create_order_item("O0002", name: "CRP")
    items_csv = <<~CSV
      result_item_code,name,short_name,name_kana,category,specimen_code,data_type,display_unit,ucum_unit,code_value_list,value_code_system,decimal_places,jlac11_code,jlac10_code,loinc_code,display_order
      O0001-01,血液ガス pH,pH,,生化学検査,223,PQ,,[pH],,,3,,,,10
      O0001-02,血液ガス PCO2,PCO2,,生化学検査,223,PQ,mmHg,mm[Hg],,,1,,,,20
    CSV
    mappings_csv = <<~CSV
      order_item_code,result_item_code,display_order
      O0001,O0001-01,10
      O0001,O0001-02,20
    CSV

    with_csv(items: items_csv, mappings: mappings_csv) do |items_path, mappings_path|
      result = described_class.call(items_csv: items_path, mappings_csv: mappings_path)

      expect(result).to have_attributes(csv_items: 2, csv_mappings: 2, created: 1, mapped: 1, kept: 1)
      expect(Master::LabResultItem.exists?(result_item_code: "O0001")).to be(false)
      expect(Master::LabOrderItemResult.where(order_item_code: "O0001").order(:display_order).pluck(:result_item_code))
        .to eq(%w[O0001-01 O0001-02])
      expect(Master::LabResultItem.find_by!(result_item_code: "O0001-01")).to have_attributes(decimal_places: 3, ucum_unit: "[pH]")

      # 再実行で CSV 分も増えない。
      again = described_class.call(items_csv: items_path, mappings_csv: mappings_path)
      expect(again).to have_attributes(csv_items: 0, csv_mappings: 0, created: 0, mapped: 0, kept: 2)
    end
  end

  it "同梱の CSV は結果項目と対応表の整合が取れている" do
    rows = CSV.read(Rails.root.join(described_class::ITEMS_CSV), headers: true)
    codes = rows.map { |r| r["result_item_code"] }
    expect(codes.uniq.size).to eq(codes.size)
    expect(rows.all? { |r| described_class::ITEM_COLUMNS.include?("data_type") && Master::LabResultItem::DATA_TYPES.include?(r["data_type"]) }).to be(true)

    mappings = CSV.read(Rails.root.join(described_class::MAPPINGS_CSV), headers: true)
    expect(mappings.map { |m| m["result_item_code"] }).to match_array(codes)
  end
end
