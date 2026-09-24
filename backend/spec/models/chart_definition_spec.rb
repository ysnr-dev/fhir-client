require "rails_helper"

RSpec.describe ChartDefinition do
  def definition(**overrides)
    {
      "schema_version" => 1,
      "axis" => { "unit" => "month", "columns" => 12 },
      "items" => [
        { "key" => "lab:0001", "source" => "lab", "name" => "WBC", "unit" => "10*3/uL",
          "codings" => [{ "system" => "http://example.org/lab", "code" => "0001" }] }
      ],
      "events" => %w[encounter surgery],
      "overlay" => false
    }.merge(overrides.transform_keys(&:to_s))
  end

  def build(**attrs)
    described_class.new({ scope: "facility", name: "血算", definition: definition }.merge(attrs))
  end

  it "既定で有効" do
    expect(build).to be_valid
  end

  it "code を採番する" do
    record = build
    record.validate
    expect(record.code).to be_present
  end

  describe "持ち主" do
    it "院内共通に owner_id は付けられない" do
      expect(build(owner_id: "dept-1")).not_to be_valid
    end

    it "診療科・医師は owner_id が要る" do
      expect(build(scope: "department")).not_to be_valid
      expect(build(scope: "department", owner_id: "dept-1")).to be_valid
      expect(build(scope: "practitioner")).not_to be_valid
      expect(build(scope: "practitioner", owner_id: "prac-1")).to be_valid
    end

    it "同じ持ち主で名前は重複できない(持ち主が違えば重複できる)" do
      build.save!
      expect(build).not_to be_valid
      expect(build(scope: "practitioner", owner_id: "prac-1")).to be_valid
    end
  end

  describe "definition の形" do
    it "連想配列でなければ無効(空は未設定として通す)" do
      expect(build(definition: [{ "key" => "a" }])).not_to be_valid
      expect(build(definition: {})).to be_valid
    end

    it "未知のキーは無効" do
      expect(build(definition: definition.merge("bogus" => 1))).not_to be_valid
    end

    it "schema_version は 1 のみ" do
      expect(build(definition: definition("schema_version" => 2))).not_to be_valid
    end

    it "axis.unit は day / month / year のみ" do
      expect(build(definition: definition("axis" => { "unit" => "week", "columns" => 4 }))).not_to be_valid
    end

    it "axis.columns は範囲内の整数" do
      expect(build(definition: definition("axis" => { "unit" => "day", "columns" => 0 }))).not_to be_valid
      expect(build(definition: definition("axis" => { "unit" => "day", "columns" => 121 }))).not_to be_valid
      expect(build(definition: definition("axis" => { "unit" => "day", "columns" => "14" }))).not_to be_valid
    end

    it "items は上限 30 件" do
      items = Array.new(31) do |i|
        { "key" => "lab:#{i}", "source" => "lab", "name" => "項目#{i}",
          "codings" => [{ "system" => "s", "code" => "c#{i}" }] }
      end
      expect(build(definition: definition("items" => items))).not_to be_valid
    end

    it "item の key は必須で重複できない" do
      item = { "source" => "lab", "name" => "WBC", "codings" => [{ "system" => "s", "code" => "c" }] }
      expect(build(definition: definition("items" => [item]))).not_to be_valid
      expect(build(definition: definition("items" => [item.merge("key" => "a"), item.merge("key" => "a")]))).not_to be_valid
    end

    it "item の source は lab / vital / template のみ" do
      item = { "key" => "a", "source" => "note", "name" => "WBC", "codings" => [{ "system" => "s", "code" => "c" }] }
      expect(build(definition: definition("items" => [item]))).not_to be_valid
    end

    it "codings は 1 件以上で system と code が要る" do
      item = { "key" => "a", "source" => "lab", "name" => "WBC" }
      expect(build(definition: definition("items" => [item.merge("codings" => [])]))).not_to be_valid
      expect(build(definition: definition("items" => [item.merge("codings" => [{ "code" => "c" }])]))).not_to be_valid
    end

    it "components は code と name が要る" do
      item = { "key" => "a", "source" => "vital", "name" => "血圧",
               "codings" => [{ "system" => "http://loinc.org", "code" => "85354-9" }] }
      expect(build(definition: definition("items" => [item.merge("components" => [{ "code" => "8480-6", "name" => "収縮期" }])]))).to be_valid
      expect(build(definition: definition("items" => [item.merge("components" => [{ "code" => "8480-6" }])]))).not_to be_valid
    end

    it "options は code と display が要る(テンプレートの選択肢項目)" do
      item = { "key" => "template:q1:edema", "source" => "template", "name" => "浮腫",
               "codings" => [{ "system" => "http://example.org/q", "code" => "edema" }] }
      options = [{ "system" => "http://example.org/a", "code" => "none", "display" => "なし" },
                 { "code" => "mild", "display" => "軽度" }]
      expect(build(definition: definition("items" => [item.merge("options" => options)]))).to be_valid
      expect(build(definition: definition("items" => [item.merge("options" => [{ "code" => "none" }])]))).not_to be_valid
      expect(build(definition: definition("items" => [item.merge("options" => "none")]))).not_to be_valid
    end

    it "events は既知の種別のみで重複できない" do
      expect(build(definition: definition("events" => %w[encounter bogus]))).not_to be_valid
      expect(build(definition: definition("events" => %w[encounter encounter]))).not_to be_valid
    end

    it "drugs は key・name と、yj7 か codes のどちらかが要る" do
      drug = { "key" => "yj7:3332001", "name" => "ワルファリン", "yj7" => "3332001", "codes" => ["613330003"] }
      expect(build(definition: definition("drugs" => [drug]))).to be_valid
      expect(build(definition: definition("drugs" => [drug.except("yj7")]))).to be_valid
      expect(build(definition: definition("drugs" => [drug.except("yj7", "codes")]))).not_to be_valid
      expect(build(definition: definition("drugs" => [drug.except("name")]))).not_to be_valid
      expect(build(definition: definition("drugs" => [drug, drug]))).not_to be_valid
    end

    it "drugs の yj7 は 7 桁の数字、codes は文字列の配列" do
      drug = { "key" => "a", "name" => "ワルファリン" }
      expect(build(definition: definition("drugs" => [drug.merge("yj7" => "3332001F")]))).not_to be_valid
      expect(build(definition: definition("drugs" => [drug.merge("codes" => [613330003])]))).not_to be_valid
      expect(build(definition: definition("drugs" => [drug.merge("codes" => ["c"], "bogus" => 1)]))).not_to be_valid
    end

    it "drugs は上限 20 件" do
      drugs = Array.new(21) { |i| { "key" => "code:#{i}", "name" => "薬#{i}", "codes" => ["c#{i}"] } }
      expect(build(definition: definition("drugs" => drugs))).not_to be_valid
    end

    it "overlay は真偽値のみ" do
      expect(build(definition: definition("overlay" => true))).to be_valid
      expect(build(definition: definition("overlay" => "yes"))).not_to be_valid
    end
  end

  describe "#definition_with_defaults" do
    it "欠けたキーを既定値で埋める" do
      record = build(definition: { "items" => [] })
      expect(record.definition_with_defaults).to eq(
        "schema_version" => 1,
        "axis" => { "unit" => "month", "columns" => 12 },
        "items" => [],
        "events" => [],
        "drugs" => [],
        "overlay" => false,
      )
    end
  end

  describe ".roots_for" do
    it "院内共通 + 指定した診療科 + 指定した医師だけを返す" do
      described_class.create!(scope: "facility", name: "共通", definition: definition)
      described_class.create!(scope: "department", owner_id: "dept-1", name: "内科", definition: definition)
      described_class.create!(scope: "department", owner_id: "dept-2", name: "外科", definition: definition)
      described_class.create!(scope: "practitioner", owner_id: "prac-1", name: "自分", definition: definition)
      described_class.create!(scope: "practitioner", owner_id: "prac-2", name: "他人", definition: definition)

      names = described_class.roots_for(department_id: "dept-1", practitioner_id: "prac-1").pluck(:name)
      expect(names).to contain_exactly("共通", "内科", "自分")
      expect(described_class.roots_for(department_id: nil, practitioner_id: nil).pluck(:name)).to eq(["共通"])
    end
  end
end
