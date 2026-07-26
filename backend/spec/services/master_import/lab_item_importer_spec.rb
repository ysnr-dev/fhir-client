require "rails_helper"

RSpec.describe MasterImport::LabItemImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/lab_items_sample.csv"), "rb")
  end

  it "imports all data rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::LabItem.count).to eq(3)

    record = Master::LabItem.find_by(jlac11_code: "C1002000025002755")
    expect(record.category_name).to eq("生化学検査")
    expect(record.major_item).to eq("総蛋白(TP)")
    expect(record.fhir_item_name).to eq("総蛋白(TP)")
    expect(record.fhir_identifier).to eq("TP")
    expect(record.abbreviation).to eq("TP")
    expect(record.sales_name).to eq("「セロテック」TP-L")
    expect(record.jlac11_specimen).to eq("血清")
    expect(record.display_unit).to eq("g/dL")
    expect(record.jlac10_specimen).to eq("血清")
    expect(record.jlac10_method).to eq("可視吸光光度法")
    expect(record.jlac10_code).to eq("3A010000002327101")
    expect(record.data_type).to eq("PQ")
    expect(record.display_order).to eq("100")
    expect(record.start_date).to eq("00000000")
    expect(record.end_date).to eq("99999999")
  end

  it "fills the normalized search columns" do
    described_class.call(sample_file)

    record = Master::LabItem.find_by(jlac11_code: "C1002000025002755")
    expect(record.search_name).to eq(Master::SearchNormalizer.normalize("総蛋白(TP)"))
    expect(record.search_abbreviation).to eq(Master::SearchNormalizer.normalize("TP"))
  end

  it "replaces existing data wholesale (delete-all + reinsert)" do
    Master::LabItem.create!(jlac11_code: "stale")

    described_class.call(sample_file)

    expect(Master::LabItem.where(jlac11_code: "stale")).not_to exist
    expect(Master::LabItem.count).to eq(3)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::LabItem.create!(jlac11_code: "kept")

    bad_file = StringIO.new("\"h1\",\"h2\"\n\"only_two_columns\",\"x\"\n")

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::LabItem.count).to eq(1)
    expect(Master::LabItem.where(jlac11_code: "kept")).to exist
  end
end
