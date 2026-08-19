require "rails_helper"

RSpec.describe LabLabelNumber do
  describe ".check_digit" do
    it "computes M10W3 (same scheme as JAN/EAN)" do
      # EAN-13 の例: 490123456789 のチェックデジットは 4
      expect(described_class.check_digit("490123456789")).to eq("4")
      expect(described_class.check_digit("0000000001")).to eq("7")
      expect(described_class.check_digit("0000000000")).to eq("0")
    end
  end

  describe ".allocate" do
    it "returns an 11-digit number (zero-padded sequence + check digit)" do
      number = described_class.allocate

      expect(number).to match(/\A\d{11}\z/)
      expect(described_class.check_digit(number[0, 10])).to eq(number[10])
    end

    it "never returns the same number twice" do
      numbers = Array.new(3) { described_class.allocate }

      expect(numbers.uniq.length).to eq(3)
    end
  end
end
