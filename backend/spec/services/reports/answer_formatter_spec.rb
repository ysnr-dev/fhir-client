require "rails_helper"

RSpec.describe Reports::AnswerFormatter do
  subject(:formatter) { described_class.new(units) }

  let(:units) { {} }

  describe "value precedence" do
    it "prefers valueCoding.display over code" do
      answer = { "valueCoding" => { "code" => "c1", "display" => "頭痛" } }
      expect(formatter.format("q1", [answer])).to eq("頭痛")
    end

    it "falls back to valueCoding.code without display" do
      answer = { "valueCoding" => { "code" => "c1" } }
      expect(formatter.format("q1", [answer])).to eq("c1")
    end

    it "formats valueString / valueInteger / valueDecimal" do
      expect(formatter.format("q1", [{ "valueString" => "テキスト" }])).to eq("テキスト")
      expect(formatter.format("q1", [{ "valueInteger" => 3 }])).to eq("3")
      expect(formatter.format("q1", [{ "valueDecimal" => 37.2 }])).to eq("37.2")
    end
  end

  describe "dates" do
    it "formats valueDate as YYYY/MM/DD" do
      expect(formatter.format("q1", [{ "valueDate" => "2026-07-30" }])).to eq("2026/07/30")
    end

    it "formats valueDateTime in JST" do
      expect(formatter.format("q1", [{ "valueDateTime" => "2026-07-30T01:23:00Z" }]))
        .to eq("2026/07/30 10:23")
    end

    it "keeps valueTime as-is" do
      expect(formatter.format("q1", [{ "valueTime" => "13:45:00" }])).to eq("13:45:00")
    end
  end

  describe "units" do
    let(:units) { { "temp" => "℃" } }

    it "appends the unit after the value" do
      expect(formatter.format("temp", [{ "valueDecimal" => 37.2 }])).to eq("37.2 ℃")
    end

    it "does not append units for other linkIds" do
      expect(formatter.format("other", [{ "valueDecimal" => 5 }])).to eq("5")
    end
  end

  describe "multiple answers" do
    it "joins with 、" do
      answers = [{ "valueString" => "咳" }, { "valueString" => "発熱" }]
      expect(formatter.format("q1", answers)).to eq("咳、発熱")
    end
  end
end
