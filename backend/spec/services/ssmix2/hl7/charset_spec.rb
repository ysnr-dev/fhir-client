require "rails_helper"

RSpec.describe Ssmix2::Hl7::Charset do
  it "encodes JIS X 0208 and the CP932 extensions, and reports what it had to drop" do
    result = described_class.encode("患者^髙橋①~〜 ｶﾅ 𩸽")

    expect(result.bytes.encoding).to eq(Encoding::ASCII_8BIT)
    expect(result.bytes.encode("UTF-8", "CP50221")).to eq("患者^髙橋①~～ カナ ?")
    expect(result.dropped).to eq(["𩸽"])
  end

  it "folds half-width kana to full-width without touching full-width alphanumerics" do
    expect(described_class.normalize("ｶﾞｷ ＡＢＣ１２３")).to eq("ガキ ＡＢＣ１２３")
  end
end
