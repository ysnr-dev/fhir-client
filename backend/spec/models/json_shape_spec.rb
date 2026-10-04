require "rails_helper"

RSpec.describe JsonShape do
  describe ".errors" do
    let(:row) do
      {
        fields: { "key" => :text, "note" => :string, "kind" => { enum: %w[a b] } },
        required: %w[key],
        check: ->(value, path) { value["note"] == "ng" ? ["#{path} は受け付けられません"] : [] }
      }
    end
    let(:shape) do
      {
        fields: {
          "version" => { const: 1 },
          "flag" => :boolean,
          "count" => { integer: { min: 1, max: 5, unit: "整数" } },
          "rows" => { list: row, min: 1, max: 3, unique: "key" },
          "tags" => { list: :text, unique: true },
          "code" => { pattern: /\A\d{3}\z/, label: " 3 桁の数字", strict: true }
        }
      }
    end

    it "妥当な値と nil は通す" do
      value = { "version" => 1, "flag" => false, "count" => 5, "rows" => [{ "key" => "a", "kind" => "b" }],
                "tags" => %w[x y], "code" => "123" }
      expect(described_class.errors(shape, value)).to eq([])
      expect(described_class.errors(shape, { "rows" => nil })).to eq([])
    end

    it "葉の型を見る" do
      value = { "version" => 2, "flag" => "yes", "count" => 6, "code" => 123 }
      expect(described_class.errors(shape, value)).to eq(
        [
          "version は 1 で指定してください",
          "flag は true / false で指定してください",
          "count は 1〜5 の整数で指定してください",
          "code は 3 桁の数字で指定してください"
        ]
      )
    end

    it "連想配列の並びは要素ごとに見て、必須・重複・check を位置つきで返す" do
      value = { "rows" => [{ "key" => "a" }, { "key" => "a", "note" => "ng" }, { "kind" => "c" }] }
      expect(described_class.errors(shape, value)).to eq(
        [
          "rows[1] は受け付けられません",
          "rows[1].key が重複しています",
          "rows[2].kind は a / b のいずれかで指定してください",
          "rows[2].key は必須です"
        ]
      )
    end

    it "並びの件数と、葉の並びの重複を見る" do
      expect(described_class.errors(shape, { "rows" => [] })).to eq(["rows は 1 件以上の配列で指定してください"])
      expect(described_class.errors(shape, { "rows" => Array.new(4) { |i| { "key" => i.to_s } } }))
        .to eq(["rows は 3 件までです"])
      expect(described_class.errors(shape, { "rows" => {} })).to eq(["rows は配列で指定してください"])
      expect(described_class.errors(shape, { "rows" => [nil] })).to eq(["rows[0] は連想配列で指定してください"])
      expect(described_class.errors(shape, { "tags" => %w[x x] })).to eq(["tags が重複しています"])
      expect(described_class.errors(shape, { "tags" => ["x", ""] })).to eq(["tags は空でない文字列の配列で指定してください"])
    end
  end
end
