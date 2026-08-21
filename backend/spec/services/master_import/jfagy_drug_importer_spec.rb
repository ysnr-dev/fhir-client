require "rails_helper"

RSpec.describe MasterImport::JfagyDrugImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/jfagy_drugs_sample.csv"), "rb")
  end

  it "imports all data rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::JfagyDrug.count).to eq(3)

    record = Master::JfagyDrug.find_by(jfagy_code: "GCM1124017B1ZZZ")
    expect(record.name).to eq("ジアゼパム")
    expect(record.record_date).to eq("20260801")
    expect(record.end_date).to eq("99999999")
    expect(record.change_category).to eq("1")
  end

  it "fills the normalized search column" do
    described_class.call(sample_file)

    record = Master::JfagyDrug.find_by(jfagy_code: "GCM1119402A1ZZZ")
    expect(record.search_name).to eq(Master::SearchNormalizer.normalize("プロポフォール"))
  end

  it "replaces existing data wholesale (delete-all + reinsert)" do
    Master::JfagyDrug.create!(jfagy_code: "stale", name: "stale")

    described_class.call(sample_file)

    expect(Master::JfagyDrug.where(jfagy_code: "stale")).not_to exist
    expect(Master::JfagyDrug.count).to eq(3)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::JfagyDrug.create!(jfagy_code: "kept", name: "kept")

    bad_file = StringIO.new("\"h1\",\"h2\"\n\"only_two_columns\",\"x\"\n")

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::JfagyDrug.count).to eq(1)
    expect(Master::JfagyDrug.where(jfagy_code: "kept")).to exist
  end
end
