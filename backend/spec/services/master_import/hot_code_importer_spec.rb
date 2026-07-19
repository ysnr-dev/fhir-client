require "rails_helper"

RSpec.describe MasterImport::HotCodeImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/hot_code_sample.txt"), "rb")
  end

  it "imports all data rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::HotCode.count).to eq(3)

    record = Master::HotCode.find_by(hot_code: "100303101")
    expect(record.hot7_code).to eq("1003031")
    expect(record.notification_name).to eq("（局）ハロタン")
    expect(record.sales_name).to eq("フローセン")
    expect(record.category).to eq("外")
    expect(record.manufacturer).to eq("武田薬品")
    expect(record.update_category).to eq("1")
    expect(record.updated_on).to eq("20260630")
  end

  it "replaces existing data wholesale (delete-all + reinsert)" do
    Master::HotCode.create!(hot_code: "stale")

    described_class.call(sample_file)

    expect(Master::HotCode.where(hot_code: "stale")).not_to exist
    expect(Master::HotCode.count).to eq(3)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::HotCode.create!(hot_code: "kept")

    bad_file = StringIO.new("\"h1\",\"h2\"\n\"only_two_columns\",\"x\"\n".encode("CP932"))

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::HotCode.count).to eq(1)
    expect(Master::HotCode.where(hot_code: "kept")).to exist
  end
end
