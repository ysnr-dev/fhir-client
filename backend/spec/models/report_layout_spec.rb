require "rails_helper"

RSpec.describe ReportLayout do
  VALID_TLF = { version: "0.9.0", config: {}, items: [] }.to_json

  def build_layout(attrs = {})
    described_class.new(
      {
        name: "問診票",
        questionnaire_url: "http://example.com/Questionnaire/intake",
        questionnaire_version: "1.0.0",
        tlf: VALID_TLF
      }.merge(attrs)
    )
  end

  describe "validations" do
    it "accepts a valid layout" do
      expect(build_layout).to be_valid
    end

    it "requires name / questionnaire_url / tlf" do
      layout = described_class.new
      expect(layout).not_to be_valid
      expect(layout.errors[:name]).to be_present
      expect(layout.errors[:questionnaire_url]).to be_present
      expect(layout.errors[:tlf]).to be_present
    end

    it "rejects invalid JSON in tlf" do
      layout = build_layout(tlf: "{not json")
      expect(layout).not_to be_valid
      expect(layout.errors[:tlf]).to be_present
    end

    it "rejects JSON that is not a ThinReports layout" do
      layout = build_layout(tlf: { foo: "bar" }.to_json)
      expect(layout).not_to be_valid
      expect(layout.errors[:tlf]).to be_present
    end

    it "rejects tlf larger than the size limit" do
      big = { items: [], padding: "x" * (described_class::TLF_MAX_BYTESIZE + 1) }.to_json
      layout = build_layout(tlf: big)
      expect(layout).not_to be_valid
      expect(layout.errors[:tlf]).to be_present
    end
  end

  describe "canonical uniqueness" do
    it "rejects a duplicate url + version pair" do
      build_layout.save!
      dup = build_layout(name: "別名")
      expect(dup).not_to be_valid
      expect(dup.errors[:questionnaire_url]).to be_present
    end

    it "rejects duplicates when both versions are blank" do
      build_layout(questionnaire_version: "").save!
      dup = build_layout(questionnaire_version: "")
      expect(dup).not_to be_valid
    end

    it "allows the same url with a different version" do
      build_layout.save!
      expect(build_layout(questionnaire_version: "2.0.0")).to be_valid
    end
  end

  describe ".for_canonical" do
    it "finds by url|version" do
      layout = build_layout.tap(&:save!)
      found = described_class.for_canonical("http://example.com/Questionnaire/intake|1.0.0")
      expect(found).to eq(layout)
    end

    it "finds a version-less canonical by url alone" do
      layout = build_layout(questionnaire_version: "").tap(&:save!)
      expect(described_class.for_canonical("http://example.com/Questionnaire/intake")).to eq(layout)
    end

    it "returns nil when the version does not match" do
      build_layout.save!
      expect(described_class.for_canonical("http://example.com/Questionnaire/intake|9.9.9")).to be_nil
    end

    it "returns nil for blank input" do
      expect(described_class.for_canonical(nil)).to be_nil
      expect(described_class.for_canonical("")).to be_nil
    end
  end

  describe "#canonical" do
    it "joins url and version with |" do
      expect(build_layout.canonical).to eq("http://example.com/Questionnaire/intake|1.0.0")
    end

    it "omits the | when version is blank" do
      expect(build_layout(questionnaire_version: "").canonical)
        .to eq("http://example.com/Questionnaire/intake")
    end
  end

  describe "#with_tlf_file" do
    it "yields a readable .tlf path containing the layout JSON" do
      layout = build_layout
      layout.with_tlf_file do |path|
        expect(path).to end_with(".tlf")
        expect(File.read(path)).to eq(VALID_TLF)
      end
    end
  end
end
