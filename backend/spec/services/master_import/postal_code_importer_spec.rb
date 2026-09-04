require "rails_helper"

RSpec.describe MasterImport::PostalCodeImporter do
  def fixture
    File.open(Rails.root.join("spec/fixtures/files/postal_codes_sample.csv"), "rb")
  end

  it "郵便番号・都道府県・市区町村・町域を取り込む" do
    result = described_class.call(fixture)

    expect(result.imported_count).to eq(5)
    chiyoda = Master::PostalCode.find_by(postal_code: "1000001")
    expect(chiyoda).to have_attributes(
      jis_code: "13101",
      prefecture: "東京都",
      city: "千代田区",
      town: "千代田",
      prefecture_kana: "トウキョウト",
      town_kana: "チヨダ"
    )
  end

  it "町域ではなく使い方を説明している行は町域を空にする" do
    described_class.call(fixture)

    expect(Master::PostalCode.find_by(postal_code: "0600000").town).to eq("")
    expect(Master::PostalCode.find_by(postal_code: "1000301").town).to eq("")
    expect(Master::PostalCode.find_by(postal_code: "3060433").town).to eq("")
  end

  it "町域の括弧書きは住所に入れない" do
    described_class.call(fixture)

    odori = Master::PostalCode.find_by(postal_code: "0600042")
    expect(odori.town).to eq("大通西")
    expect(odori.town_kana).to eq("オオドオリニシ")
  end
end
