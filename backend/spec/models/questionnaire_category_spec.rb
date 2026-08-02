require "rails_helper"

RSpec.describe QuestionnaireCategory do
  describe "validations" do
    it "accepts a category with just a name" do
      expect(described_class.new(name: "初診")).to be_valid
    end

    it "requires a name" do
      category = described_class.new
      expect(category).not_to be_valid
      expect(category.errors[:name]).to be_present
    end

    it "rejects a duplicate name" do
      described_class.create!(name: "初診")

      duplicate = described_class.new(name: "初診")

      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:name]).to be_present
    end

    it "rejects a name longer than the limit" do
      category = described_class.new(name: "あ" * (described_class::NAME_MAX_LENGTH + 1))

      expect(category).not_to be_valid
      expect(category.errors[:name]).to be_present
    end
  end

  describe "code" do
    it "assigns a UUID when omitted" do
      category = described_class.create!(name: "初診")

      expect(category.code).to match(/\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/)
    end

    # 別環境からのインポートで元の code を復元できるようにするため。
    it "keeps an explicitly given code" do
      category = described_class.create!(name: "初診", code: "imported-code")

      expect(category.code).to eq("imported-code")
    end

    it "rejects a duplicate code" do
      described_class.create!(name: "初診", code: "same")

      duplicate = described_class.new(name: "再診", code: "same")

      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:code]).to be_present
    end
  end

  describe ".ordered" do
    it "sorts by display_order then id" do
      last = described_class.create!(name: "検査", display_order: 2)
      first = described_class.create!(name: "初診", display_order: 1)
      same_order = described_class.create!(name: "再診", display_order: 1)

      expect(described_class.ordered.to_a).to eq([first, same_order, last])
    end
  end
end
