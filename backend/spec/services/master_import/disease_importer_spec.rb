require "rails_helper"

RSpec.describe MasterImport::DiseaseImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/diseases_sample.txt"), "rb")
  end

  it "imports all data rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::Disease.count).to eq(3)

    record = Master::Disease.find_by(management_number: "20065325")
    expect(record.change_category).to eq("0")
    expect(record.name).to eq("急性膵炎")
    expect(record.name_kana).to eq("キュウセイスイエン")
    expect(record.adoption_category).to eq("1")
    expect(record.exchange_code).to eq("C142")
    expect(record.icd10_2013).to eq("K859")
    expect(record.receipt_code).to eq("8830052")
    expect(record.abbreviated_name).to eq("急性膵炎")
    expect(record.usage_field).to eq("1")
    expect(record.change_history_number).to eq("201")
    expect(record.updated_on).to eq("20150101")
    expect(record.single_use_prohibited_category).to eq("00")
    expect(record.non_billable_category).to eq("0")
  end

  it "imports deleted records with the transfer target" do
    described_class.call(sample_file)

    record = Master::Disease.find_by(management_number: "20054321")
    expect(record.change_category).to eq("1")
    expect(record.transfer_management_number).to eq("20065325")
    expect(record.exchange_code).to eq("")
  end

  it "fills the normalized search columns" do
    described_class.call(sample_file)

    record = Master::Disease.find_by(management_number: "20065325")
    expect(record.search_name).to eq(Master::SearchNormalizer.normalize("急性膵炎"))
    expect(record.search_kana).to eq(Master::SearchNormalizer.normalize("キュウセイスイエン"))
  end

  it "replaces existing data wholesale (delete-all + reinsert)" do
    Master::Disease.create!(management_number: "stale", name: "旧データ")

    described_class.call(sample_file)

    expect(Master::Disease.where(management_number: "stale")).not_to exist
    expect(Master::Disease.count).to eq(3)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::Disease.create!(management_number: "kept", name: "既存")

    bad_file = StringIO.new("\"only_two_columns\",\"x\"\n")

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::Disease.count).to eq(1)
    expect(Master::Disease.where(management_number: "kept")).to exist
  end
end
