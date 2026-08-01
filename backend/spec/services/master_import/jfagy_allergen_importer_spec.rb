require "rails_helper"

RSpec.describe MasterImport::JfagyAllergenImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/jfagy_allergens_sample.csv"), "rb")
  end

  it "imports all data rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::JfagyAllergen.count).to eq(3)

    record = Master::JfagyAllergen.find_by(jfagy_code: "J9FA15000000")
    expect(record.display_seq).to eq("15")
    expect(record.name).to eq("小麦")
    expect(record.name_kana).to eq("こむぎ")
    expect(record.name_en).to eq("Wheat")
    expect(record.level).to eq("3")
    expect(record.main_flag).to eq("1")
    expect(record.guideline).to eq("1")
    expect(record.cxg_category).to eq("0")
    expect(record.record_date).to eq("00000000")
    expect(record.end_date).to eq("99999999")
  end

  it "parses quoted fields containing commas" do
    described_class.call(sample_file)

    record = Master::JfagyAllergen.find_by(jfagy_code: "J9FG25000000")
    expect(record.name).to eq("麦芽，麦芽抽出物及び麦芽シロップ")
    expect(record.name_en).to eq("Malt, malt extract, and malt syrup")
    expect(record.main_flag).to be_nil
  end

  it "fills the normalized search columns" do
    described_class.call(sample_file)

    record = Master::JfagyAllergen.find_by(jfagy_code: "J9FA15000000")
    expect(record.search_name).to eq(Master::SearchNormalizer.normalize("小麦"))
    expect(record.search_kana).to eq(Master::SearchNormalizer.normalize("こむぎ"))
  end

  it "replaces existing data wholesale (delete-all + reinsert)" do
    Master::JfagyAllergen.create!(jfagy_code: "stale", name: "stale")

    described_class.call(sample_file)

    expect(Master::JfagyAllergen.where(jfagy_code: "stale")).not_to exist
    expect(Master::JfagyAllergen.count).to eq(3)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::JfagyAllergen.create!(jfagy_code: "kept", name: "kept")

    bad_file = StringIO.new("\"h1\",\"h2\"\n\"only_two_columns\",\"x\"\n")

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::JfagyAllergen.count).to eq(1)
    expect(Master::JfagyAllergen.where(jfagy_code: "kept")).to exist
  end
end
