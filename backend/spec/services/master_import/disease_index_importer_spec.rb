require "rails_helper"

RSpec.describe MasterImport::DiseaseIndexImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/disease_indexes_sample.txt"), "rb")
  end

  it "imports all data rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::DiseaseIndex.count).to eq(3)

    record = Master::DiseaseIndex.find_by(term: "急性膵炎")
    expect(record.target_code).to eq("C142")
    expect(record.disease_modifier_category).to eq("1")
    expect(record.kana_kanji_category).to eq("1")
    expect(record.synonym_category).to eq("0")
    expect(record.variant_category).to eq("9")
    expect(record.first_edition_category).to eq("9")
    expect(record.language_category).to eq("")
    expect(record.abbreviation_category).to eq("")
  end

  it "imports index terms for modifiers (disease_modifier_category=2)" do
    described_class.call(sample_file)

    record = Master::DiseaseIndex.find_by(term: "急性")
    expect(record.target_code).to eq("0001")
    expect(record.disease_modifier_category).to eq("2")
  end

  it "fills the normalized search column" do
    described_class.call(sample_file)

    record = Master::DiseaseIndex.find_by(term: "キュウセイスイエン")
    expect(record.search_term).to eq(Master::SearchNormalizer.normalize("キュウセイスイエン"))
  end

  it "replaces existing data wholesale (delete-all + reinsert)" do
    Master::DiseaseIndex.create!(term: "stale", target_code: "0000")

    described_class.call(sample_file)

    expect(Master::DiseaseIndex.where(term: "stale")).not_to exist
    expect(Master::DiseaseIndex.count).to eq(3)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::DiseaseIndex.create!(term: "kept", target_code: "0000")

    bad_file = StringIO.new("\"only_two_columns\",\"x\"\n")

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::DiseaseIndex.count).to eq(1)
    expect(Master::DiseaseIndex.where(term: "kept")).to exist
  end
end
