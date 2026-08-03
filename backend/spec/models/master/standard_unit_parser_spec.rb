require "rails_helper"

RSpec.describe Master::StandardUnitParser do
  def parse(text)
    described_class.parse(text)&.to_h&.compact
  end

  describe ".parse" do
    it "力価量が明示された規格を分解する" do
      expect(parse("１０ｍｇ１錠")).to eq(
        pack_quantity: 1.0, pack_unit: "錠", strength_value: 10.0, strength_unit: "mg"
      )
    end

    it "濃度%だけの規格は薬価算定単位を基準量として持つ" do
      expect(parse("２％１ｇ")).to eq(pack_quantity: 1.0, pack_unit: "g", concentration_pct: 2.0)
    end

    it "濃度%と容量が並ぶ規格を分解する" do
      expect(parse("５％５ｍＬ１管")).to eq(
        pack_quantity: 1.0, pack_unit: "管", concentration_pct: 5.0, volume_ml: 5.0
      )
    end

    it "力価量と容量が並ぶ規格を分解する" do
      expect(parse("３０ｍｇ２０ｍＬ１管")).to eq(
        pack_quantity: 1.0, pack_unit: "管", strength_value: 30.0, strength_unit: "mg", volume_ml: 20.0
      )
    end

    it "規格部が無いもの(生薬など)は薬価算定単位だけを返す" do
      expect(parse("１０ｇ")).to eq(pack_quantity: 10.0, pack_unit: "g")
    end

    it "容量だけの規格(輸液など)を分解する" do
      expect(parse("２５０ｍＬ１袋")).to eq(pack_quantity: 1.0, pack_unit: "袋", volume_ml: 250.0)
    end

    it "L 表記の容量を mL に揃える" do
      expect(parse("１．５Ｌ１袋（排液用バッグ付）")).to eq(
        pack_quantity: 1.0, pack_unit: "袋", volume_ml: 1500.0
      )
    end

    it "付属品の括弧は無視する" do
      expect(parse("１，０００国際単位１瓶（溶解液付）")).to eq(
        pack_quantity: 1.0, pack_unit: "瓶", strength_value: 1000.0, strength_unit: "国際単位"
      )
    end

    it "本体から力価が取れないときだけ括弧内の規格を拾う" do
      expect(parse("（１．５ｇ）１瓶")).to eq(
        pack_quantity: 1.0, pack_unit: "瓶", strength_value: 1.5, strength_unit: "g"
      )
    end

    it "本体に力価があれば括弧内の規格は拾わない" do
      expect(parse("１１．２ｍｇ１瓶（１００μｇ）")).to eq(
        pack_quantity: 1.0, pack_unit: "瓶", strength_value: 11.2, strength_unit: "mg"
      )
    end

    it "㎡ を含む規格でも薬価算定単位量を取り違えない" do
      expect(parse("（１７．５ｍｇ）１０ｃ㎡１枚")).to eq(
        pack_quantity: 1.0, pack_unit: "枚", strength_value: 17.5, strength_unit: "mg"
      )
    end

    it "薬価算定単位が「ｍＬバイアル」でも数量と単位を取り違えない" do
      expect(parse("１００単位１ｍＬバイアル")).to eq(
        pack_quantity: 1.0, pack_unit: "バイアル", strength_value: 100.0, strength_unit: "単位", volume_ml: 1.0
      )
    end

    it "成分名が混ざっていても数値と単位だけを拾う" do
      expect(parse("ＦＲＭ２０ｍｇ１包")).to eq(
        pack_quantity: 1.0, pack_unit: "包", strength_value: 20.0, strength_unit: "mg"
      )
    end

    it "規格を持たない配合錠は薬価算定単位だけになる" do
      expect(parse("１錠")).to eq(pack_quantity: 1.0, pack_unit: "錠")
    end

    it "サイズしか書かれていない貼付剤からは規格を取らない" do
      expect(parse("１０ｃｍ×１４ｃｍ１枚")).to eq(pack_quantity: 1.0, pack_unit: "枚")
    end

    it "薬価算定単位が取れなければ nil を返す" do
      expect(parse("")).to be_nil
      expect(parse(nil)).to be_nil
      expect(parse("（溶解液付）")).to be_nil
    end
  end

  describe ".canonical_unit" do
    it "全角と半角の表記ゆれを吸収する" do
      expect(described_class.canonical_unit("ｍＬ")).to eq(described_class.canonical_unit("mL"))
    end

    it "ｍＬＶ と バイアル を同一視する" do
      expect(described_class.canonical_unit("ｍＬＶ")).to eq(described_class.canonical_unit("バイアル"))
    end
  end
end
