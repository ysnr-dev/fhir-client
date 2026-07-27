require "rails_helper"

RSpec.describe MasterImport::ModifierImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/modifiers_sample.txt"), "rb")
  end

  it "imports all data rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::Modifier.count).to eq(3)

    record = Master::Modifier.find_by(management_number: "27000001")
    expect(record.change_category).to eq("0")
    expect(record.name).to eq("急性")
    expect(record.name_kana).to eq("キュウセイ")
    expect(record.exchange_code).to eq("0001")
    expect(record.connection_position_category).to eq("17")
    expect(record.modifier_category).to eq("A4100000")
    expect(record.exclusive_group_code).to eq("ACCT")
    expect(record.receipt_code).to eq("2056")
    expect(record.description_label).to eq("")
  end

  it "fills the normalized search columns" do
    described_class.call(sample_file)

    record = Master::Modifier.find_by(management_number: "27000001")
    expect(record.search_name).to eq(Master::SearchNormalizer.normalize("急性"))
    expect(record.search_kana).to eq(Master::SearchNormalizer.normalize("キュウセイ"))
  end

  it "replaces existing data wholesale (delete-all + reinsert)" do
    Master::Modifier.create!(management_number: "stale", name: "旧データ")

    described_class.call(sample_file)

    expect(Master::Modifier.where(management_number: "stale")).not_to exist
    expect(Master::Modifier.count).to eq(3)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::Modifier.create!(management_number: "kept", name: "既存")

    bad_file = StringIO.new("\"only_two_columns\",\"x\"\n")

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::Modifier.count).to eq(1)
    expect(Master::Modifier.where(management_number: "kept")).to exist
  end
end
