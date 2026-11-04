require "rails_helper"

RSpec.describe Ssmix2::Hl7::Types do
  it "escapes the delimiters and newlines in text" do
    expect(described_class.text("a|b^c~d&e\\f\ng")).to eq("a\\F\\b\\S\\c\\R\\d\\T\\e\\E\\f\\.br\\g")
  end

  it "builds the SS-MIX2 shapes of XPN / XCN / XAD / XTN / PL" do
    expect(described_class.xpn("患者", "太郎", "I")).to eq("患者^太郎^^^^^L^I")
    expect(described_class.xcn("1234567", "医師", "一郎", "I")).to eq("1234567^医師^一郎^^^^^^^L^^^^^I")
    expect(described_class.xad("420-8601", "静岡県静岡市葵区追手町 9 番 6 号")).to eq("^^^^420-8601^JPN^H^静岡県静岡市葵区追手町 9 番 6 号")
    expect(described_class.xtn("054-211-9999")).to eq("^PRN^PH^^^^^^^^^054-211-9999")
    expect(described_class.pl_inpatient("32", "302", "1")).to eq("32^302^1^^^N")
    expect(described_class.pl_outpatient("010")).to eq("010^^^^^C")
    expect(described_class.cwe("A", "A", "JSHR002")).to eq("A^A^JSHR002")
    expect(described_class.cwe("L1", "ローカル", "99Z01", alt: %w[1013044400000000 内服 JAMISDP01]))
      .to eq("L1^ローカル^99Z01^1013044400000000^内服^JAMISDP01")
  end

  it "drops trailing empty components and repeats" do
    expect(described_class.components("a", "", "")).to eq("a")
    expect(described_class.repeats("a", "", "b")).to eq("a~b")
  end
end
