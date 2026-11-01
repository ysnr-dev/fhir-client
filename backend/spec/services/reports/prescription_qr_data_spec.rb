require "rails_helper"

# JAHIS 院外処方箋2次元シンボル記録条件規約 Ver.1.11 のレコードを、処方の各要素から
# 規約どおりに組めることを見る(docs/prescription-report-design.md §7)。
RSpec.describe Reports::PrescriptionQrData do
  let(:order) do
    {
      "authoredOn" => "2026-08-20T09:15:30+09:00",
      "occurrenceDateTime" => "2026-08-21",
      "requester" => { "reference" => "Practitioner/dr1", "display" => "児玉 義憲" },
      "extension" => [
        { "url" => PrescriptionReport::ORDER_DEPARTMENT_EXT_URL,
          "valueReference" => { "reference" => "Organization/dept1", "display" => "内科" } }
      ],
      "note" => [{ "text" => "処方箋コメント,1行目\n2行目" }]
    }
  end
  let(:patient) do
    {
      "birthDate" => "1990-01-01",
      "gender" => "male",
      "name" => [
        { "family" => "テスト", "given" => ["太郎"],
          "extension" => [{ "url" => Reports::PatientMeta::KANA_REPRESENTATION_URL, "valueCode" => "IDE" }] },
        { "family" => "テスト", "given" => ["タロウ"],
          "extension" => [{ "url" => Reports::PatientMeta::KANA_REPRESENTATION_URL, "valueCode" => "SYL" }] }
      ],
      "identifier" => [{ "value" => "2" }]
    }
  end
  let(:organization) do
    {
      "name" => "テスト病院",
      "address" => [{ "text" => "東京都板橋区板橋1-60-1", "postalCode" => "1730004" }],
      "telecom" => [{ "system" => "phone", "value" => "03-1234-5678" }, { "system" => "fax", "value" => "03-1234-5679" }],
      "identifier" => [{ "system" => PrescriptionReport::INSTITUTION_NO_SYSTEM, "value" => "1311234567" }]
    }
  end

  def medicine(index, name:, code: "612170709", general: false, dose: 3, single: 1, unit: "錠", **rest)
    PrescriptionReport::MedicineLine.new(
      order_in_rp: index, name: name, code: code, general: general, dose: dose, single: single, unit: unit,
      potency: false, comment: nil, uneven: "", substitution_block: nil, **rest
    )
  end

  def rp(number, medicines, usage_code: "1013044400000000", usage_name: "１日３回朝昼夕食後　服用",
         category: "1", days: 7, count: nil, **rest)
    PrescriptionReport::RpGroup.new(
      rp_number: number, usage_name: usage_name, usage_code: usage_code, usage_category_code: category,
      dose_days: days, dose_count: count, supplement: "", usage_comment: nil, dispense_instruction: "",
      medicines: medicines, **rest
    )
  end

  def records_for(rps, order: self.order, patient: self.patient, organization: self.organization)
    described_class.new(order: order, patient: patient, organization: organization, rps: rps).records
  end

  def record(records, number, *keys)
    records.select { |r| r.first == number && keys.each_with_index.all? { |k, i| k.nil? || r[i + 1] == k } }
  end

  it "writes the header records in the prescribed order" do
    records = records_for([rp(1, [medicine(1, name: "ノルバスク錠２．５ｍｇ")])])

    expect(records.first).to eq(["JAHIS11"])
    expect(records.map(&:first).take(11)).to eq(["JAHIS11", 1, 2, 3, 4, 5, 11, 12, 13, 22, 23])
    expect(record(records, 1).first).to eq([1, "1", "1234567", "13", "テスト病院"])
    expect(record(records, 2).first).to eq([2, "173-0004", "東京都板橋区板橋1-60-1"])
    expect(record(records, 3).first).to eq([3, "03-1234-5678", "03-1234-5679", ""])
    expect(record(records, 4).first).to eq([4, 1, "", "内科"])
    expect(record(records, 5).first).to eq([5, "", "", "児玉 義憲"])
    expect(record(records, 11).first).to eq([11, "2", "テスト 太郎", "ﾃｽﾄ ﾀﾛｳ"])
    expect(record(records, 12).first).to eq([12, 1])
    expect(record(records, 13).first).to eq([13, "19900101"])
    expect(record(records, 22).first).to eq([22, ""])
    expect(record(records, 23).first).to eq([23, "", "", 1, ""])
    expect(record(records, 51).first).to eq([51, "20260820"])
  end

  it "splits the remarks per line and per 50 characters" do
    order["note"] = [{ "text" => "あ" * 60 }]
    records = records_for([rp(1, [medicine(1, name: "薬")])])

    expect(record(records, 81)).to eq([[81, 1, "", "あ" * 50], [81, 2, "", "あ" * 10]])
  end

  it "puts the regimen line before the note in the remarks" do
    order["requisition"] = { "system" => PrescriptionReport::REGIMEN_INSTANCE_SYSTEM, "value" => "inst-1" }
    order["extension"] << { "url" => InjectionReport::REGIMEN_ORDER_EXT_URL, "extension" => [
      { "url" => "cycle", "valueInteger" => 2 }, { "url" => "day", "valueInteger" => 1 },
      { "url" => "name", "valueString" => "CapeOX" }
    ] }
    records = records_for([rp(1, [medicine(1, name: "薬")])])

    expect(record(records, 81).map(&:last)).to eq(["化学療法: CapeOX C2 Day1", "処方箋コメント,1行目", "2行目"])
    expect(record(records, 51).first).to eq([51, "20260821"])
  end

  it "records 6歳未満 as the copayment category" do
    patient["birthDate"] = "2020-08-21"
    expect(record(records_for([rp(1, [medicine(1, name: "薬")])]), 14)).to eq([[14, 3]])

    patient["birthDate"] = "2020-08-20"
    expect(record(records_for([rp(1, [medicine(1, name: "薬")])]), 14)).to be_empty
  end

  it "leaves the institution fields blank when the organization is unknown" do
    records = records_for([rp(1, [medicine(1, name: "薬")])], organization: nil)

    expect(record(records, 1).first).to eq([1, "", "", "", ""])
    expect(record(records, 2)).to be_empty
    expect(record(records, 3)).to be_empty
  end

  it "writes 内服 as 剤形 1 with the days, the JAMI usage code and the per-dose record" do
    records = records_for([rp(1, [medicine(1, name: "ノルバスク錠２．５ｍｇ", dose: 3, single: 1)])])

    expect(record(records, 101).first).to eq([101, 1, 1, "", 7])
    expect(record(records, 111).first).to eq([111, 1, 2, "1013044400000000", "１日３回朝昼夕食後　服用", 3])
    expect(record(records, 201).first).to eq([201, 1, 1, 1, 2, "612170709", "ノルバスク錠２．５ｍｇ", "3", 1, "錠"])
    expect(record(records, 241).first).to eq([241, 1, 1, "1", 3])
  end

  it "writes 頓服 as 剤形 2 with the count and no per-dose record" do
    records = records_for([rp(1, [medicine(1, name: "ロキソニン錠", dose: 1, single: 1)],
                              usage_code: "1050000000000000", usage_name: "疼痛時", days: nil, count: 10)])

    expect(record(records, 101).first).to eq([101, 1, 2, "", 10])
    expect(record(records, 111).first).to eq([111, 1, 2, "1050000000000000", "疼痛時", nil])
    expect(record(records, 241)).to be_empty
  end

  it "writes 外用 as 剤形 3 with quantity 1 and the total amount, 注射 as 5, 注入 as 9 with the name" do
    records = records_for([
      rp(1, [medicine(1, name: "ヒルドイドソフト軟膏", dose: 50, single: nil, unit: "ｇ")],
         usage_code: "2A00000000000000", category: "2", days: nil),
      rp(2, [medicine(1, name: "インスリン", dose: 1, single: nil, unit: "キット")],
         usage_code: "3000000000000000", category: "3", days: nil),
      rp(3, [medicine(1, name: "エンシュア", dose: 3, single: nil, unit: "缶")],
         usage_code: "4000000000000000", category: "4", days: nil)
    ])

    expect(record(records, 101)).to eq([[101, 1, 3, "", 1], [101, 2, 5, "", 1], [101, 3, 9, "注入", 1]])
    expect(record(records, 201, 1).first[7]).to eq("50")
  end

  it "writes a generic prescription with code kind 7 and a brand without a code with kind 1" do
    records = records_for([rp(1, [
      medicine(1, name: "【般】ニフェジピンカプセル１０ｍｇ", code: "2171014M2ZZZ", general: true),
      medicine(2, name: "手入力薬", code: "")
    ])])

    expect(record(records, 201, 1, 1).first[4, 3]).to eq([7, "2171014M2ZZZ", "【般】ニフェジピンカプセル１０ｍｇ"])
    expect(record(records, 201, 1, 2).first[4, 3]).to eq([1, "", "手入力薬"])
  end

  it "flags 力価 doses and 特定器材 codes" do
    records = records_for([rp(1, [
      medicine(1, name: "セフゾン細粒小児用１０％", dose: 150, single: 50, unit: "mg", potency: true),
      medicine(2, name: "ペンニードル", code: "700000001", dose: 14, single: nil, unit: "本")
    ])])

    expect(record(records, 201, 1, 1).first[7, 3]).to eq(["150", 2, "mg"])
    expect(record(records, 201, 1, 2).first[3]).to eq(2)
  end

  it "writes the uneven doses from the V codes instead of the per-dose record" do
    uneven = [["V11.5NNN", "朝1.5錠"], ["V20.5NNN", "夕0.5錠"]]
    records = records_for([rp(1, [medicine(1, name: "プレドニン錠", dose: 2, single: nil, uneven_codes: uneven)],
                              usage_code: "1012004400000000")])

    expect(record(records, 221).first).to eq([221, 1, 1, "1.5", "0.5", "", "", "", "V11.5NNN", "V20.5NNN", "", "", ""])
    expect(record(records, 241)).to be_empty
  end

  it "writes the supplementary usages, usage comment and dispense instructions as 用法補足" do
    records = records_for([rp(1, [medicine(1, name: "薬")],
                              supplement_codes: [["I1100000", "１日おき"]], usage_comment: "透析日に服用",
                              dispense_codes: %w[OP C SP])])

    expect(record(records, 181)).to eq([
      [181, 1, 1, 8, "１日おき", "I1100000", ""],
      [181, 1, 2, nil, "透析日に服用", "", ""],
      [181, 1, 3, 2, "一包化", "", ""],
      [181, 1, 4, 4, "粉砕", "", ""],
      [181, 1, 5, nil, "別包化", "", ""]
    ])
  end

  it "writes 後発品変更不可 / 患者希望 and the medicine comment as 薬品補足" do
    records = records_for([rp(1, [
      medicine(1, name: "ムコスタ錠", substitution_block: PrescriptionReport::MEDICAL_NECESSITY, comment: "胃保護"),
      medicine(2, name: "ノルバスク錠", substitution_block: PrescriptionReport::PATIENT_REQUEST)
    ])])

    expect(record(records, 281)).to eq([
      [281, 1, 1, 1, 3, "後発品変更不可", ""],
      [281, 1, 1, 2, nil, "胃保護", ""],
      [281, 1, 2, 1, 8, "先発医薬品患者希望", ""]
    ])
  end

  it "formats the doses without trailing zeros" do
    records = records_for([rp(1, [
      medicine(1, name: "a", dose: 1.5, single: 0.5), medicine(2, name: "b", dose: 3.0, single: 1.0),
      medicine(3, name: "c", dose: 0.25, single: nil)
    ])])

    expect(record(records, 201).map { |r| r[7] }).to eq(["1.5", "3", "0.25"])
    expect(record(records, 241).map { |r| r[3] }).to eq(["0.5", "1"])
  end

  it "encodes the lines in Shift_JIS with CRLF, full-width commas and no newlines in a field" do
    data = described_class.new(order: order, patient: patient, organization: organization,
                               rps: [rp(1, [medicine(1, name: "薬,A", comment: "1行目\n2行目")])])
    lines = data.lines

    expect(lines).to all(end_with("\r\n"))
    expect(lines.map(&:encoding).uniq).to eq([Encoding::Windows_31J])
    text = data.to_s.encode("UTF-8")
    expect(text).to start_with("JAHIS11\r\n1,1,1234567,13,テスト病院\r\n")
    expect(text).to include("薬，A")
    expect(text).to include("1行目　2行目")
    expect(text).to include("処方箋コメント，1行目\r\n81,2,,2行目")
  end

  it "replaces characters outside Windows-31J with ■ and normalizes the wave dash" do
    data = described_class.new(order: order, patient: patient, organization: organization,
                               rps: [rp(1, [medicine(1, name: "薬〜𠮷")])])

    expect(data.to_s.encode("UTF-8")).to include("薬～■")
  end

  it "cuts fields to the record length" do
    organization["name"] = "病" * 70
    records = records_for([rp(1, [medicine(1, name: "薬" * 50)])])

    expect(record(records, 1).first.last).to eq("病" * 60)
    expect(record(records, 201).first[6]).to eq("薬" * 40)
  end
end
