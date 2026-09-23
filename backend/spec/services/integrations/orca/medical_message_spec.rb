require "rails_helper"

RSpec.describe Integrations::Orca::MedicalMessage do
  def records = Integrations::ReceiptComputer::Records

  def line(code, kind: :procedure, section: nil, quantity: "1", name: code)
    records::BillingLine.new(code: code, name: name, quantity: quantity, kind: kind, section: section)
  end

  def item(category, lines, **attrs)
    records::BillingItem.new(category: category, name: category.to_s, lines: lines, **attrs)
  end

  def classes(items) = described_class.build(items).first
  def dropped(items) = described_class.build(items).last

  describe "区分" do
    it "falls back to the 種別 default when the 手技 has no 区分番号" do
      expect(classes([item(:lab, [line("160008010")])]).first["Medical_Class"]).to eq("600")
    end

    it "decides the 区分 from the 点数表の章 of each 手技" do
      expect(classes([item(:treatment, [line("170000210", section: "E000")])]).first["Medical_Class"]).to eq("700")
    end

    it "puts 輸血 (K920〜K924) into 510 instead of 手術" do
      expect(classes([item(:surgery, [line("150224910", section: "K920")])]).first["Medical_Class"]).to eq("510")
    end

    it "splits a 剤 when the 章 changes, and keeps 薬剤 with the 手技 before them" do
      built = classes([item(:surgery, [
        line("150000010", section: "K001"),
        line("610406089", kind: :medicine, quantity: "2"),
        line("150233410", section: "L008"),
        line("620098801", kind: :medicine, quantity: "1")
      ])])

      expect(built.map { |c| c["Medical_Class"] }).to eq(%w[500 540])
      expect(built[0]["Medication_info"].map { |m| m["Medication_Code"] }).to eq(%w[150000010 610406089])
      expect(built[1]["Medication_info"].map { |m| m["Medication_Code"] }).to eq(%w[150233410 620098801])
    end

    # 手術の実施記録に麻酔(L 章)の手技・加算・薬剤が並ぶと、麻酔だけ 540 の剤になる。
    it "puts 麻酔 with its 加算 and 麻酔薬 into a 540 剤 separate from the 手術" do
      built = classes([item(:surgery, [
        line("150000010", section: "K001"),
        line("150233410", section: "L008"),
        line("150231790", section: "L008", name: "時間外加算(麻酔)"),
        line("620001111", kind: :medicine, quantity: "10"),
        line("700010000", kind: :material, quantity: "1")
      ])])

      expect(built.map { |c| c["Medical_Class"] }).to eq(%w[500 540])
      expect(built[1]["Medication_info"].map { |m| m["Medication_Code"] })
        .to eq(%w[150233410 150231790 620001111 700010000])
    end

    it "drops 初診・再診 lines with the reason that the 日レセ computes them" do
      items = [item(:treatment, [line("111000110", section: "A000"), line("140000110", section: "J000")])]

      expect(classes(items).first["Medication_info"].length).to eq(1)
      expect(dropped(items).first[:reason]).to include("自動算定")
    end

    it "reports a 剤 whose 種別 has no 区分 instead of dropping it silently" do
      expect(dropped([item(:nursing, [line("x")])]).first[:reason]).to include("診療種別区分")
    end
  end

  describe "注射の区分" do
    def injection(**attrs)
      classes([item(:injection, [line("620007342", kind: :medicine, quantity: "1")], **attrs)]).first["Medical_Class"]
    end

    it "decides by 手技, 点滴 and 中心静脈" do
      expect(injection(method: "30")).to eq("320")
      expect(injection(method: "33")).to eq("310")
      expect(injection(method: "30", usage_type: "drip")).to eq("330")
      expect(injection(method: "31", usage_type: "drip")).to eq("350")
      expect(injection(method: "3A")).to eq("340")
    end

    it "falls back to the 投与経路, then to その他注射" do
      expect(injection(route: "IV")).to eq("320")
      expect(injection(route: "IV", usage_type: "drip")).to eq("330")
      expect(injection(route: "SC")).to eq("310")
      expect(injection).to eq("340")
    end
  end

  describe "回数・数量・用法" do
    it "uses 回数 for the 剤 and 数量 for the lines" do
      built = classes([item(:treatment, [line("140000110", quantity: "3")], count: "2")]).first

      expect(built["Medical_Class_Number"]).to eq("2")
      expect(built["Medication_info"].first["Medication_Number"]).to eq("3")
    end

    it "uses 投与日数 for 内服 and carries the 用法コード on each line" do
      built = classes([item(:oral, [line("610406089", kind: :medicine)], days: "7",
                                                                       usage_code: "1012040400000000")]).first

      expect(built["Medical_Class_Number"]).to eq("7")
      expect(built["Medication_info"].first["Medication_Usage_Code"]).to eq("1012040400000000")
    end
  end

  describe "コメント" do
    it "sends 842 comments as a number" do
      built = classes([item(:lab, [line("160008010"), line("842100001", kind: :comment, quantity: "12.5", name: "値")])])

      expect(built.first["Medication_info"].last).to eq("Medication_Code" => "842100001", "Medication_Name" => "値",
                                                        "Medication_Number" => "12.5")
    end

    it "splits 830 comments into 50-character lines" do
      text = "あ" * 70
      built = classes([item(:lab, [line("160008010"), line("830100111", kind: :comment, name: text)])])
      comments = built.first["Medication_info"].drop(1)

      expect(comments.map { |c| c["Medication_Name"].length }).to eq([50, 20])
      expect(comments.map { |c| c["Medication_Code"] }.uniq).to eq(["830100111"])
    end

    it "cuts free comments at 80 bytes counting 全角 as 2" do
      text = "い" * 45
      built = classes([item(:rad, [line("170000110"), line("810000001", kind: :comment, name: text)])])

      expect(built.first["Medication_info"].last["Medication_Name"]).to eq("い" * 40)
    end
  end

  it "reports 剤 beyond the 40 limit instead of dropping them silently" do
    items = Array.new(41) { |i| item(:lab, [line("16000#{i.to_s.rjust(4, '0')}")]) }

    expect(classes(items).length).to eq(40)
    expect(dropped(items).first[:reason]).to include("40")
  end
end
