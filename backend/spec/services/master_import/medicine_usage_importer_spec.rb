require "rails_helper"

RSpec.describe MasterImport::MedicineUsageImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/medicine_usages_sample.xlsx"), "rb")
  end

  it "imports data rows starting at row 5 and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(1803)
    expect(Master::MedicineUsage.count).to eq(1803)

    record = Master::MedicineUsage.find_by(usage_code: "1011000090000000")
    expect(record.basic_usage_category).to eq("内服")
    expect(record.detailed_usage_category).to eq("経口")
    expect(record.timing_category).to eq("食事ベース型")
    expect(record.usage_name).to eq("１日１回起床時　服用")
    expect(record.standard_usage_number).to eq("1101")
    expect(record.start_date).to eq("20220725")
    expect(record.end_date).to eq("99999999")
  end

  it "replaces existing data wholesale" do
    Master::MedicineUsage.create!(usage_code: "stale")

    described_class.call(sample_file)

    expect(Master::MedicineUsage.where(usage_code: "stale")).not_to exist
    expect(Master::MedicineUsage.count).to eq(1803)
  end
end
