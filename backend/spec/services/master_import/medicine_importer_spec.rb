require "rails_helper"

RSpec.describe MasterImport::MedicineImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/medicines_sample.csv"), "rb")
  end

  it "imports all rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(3)
    expect(Master::Medicine.count).to eq(3)

    record = Master::Medicine.find_by(medicine_code: "610406079")
    expect(record.name).to eq("ガスター散２％")
    expect(record.name_kana).to eq("ｶﾞｽﾀｰｻﾝ2%")
    expect(record.price).to eq(15.10)
    expect(record.generic_flag).to eq("0")
    expect(record.dosage_form).to eq("1")
    expect(record.basic_name).to eq("ガスター散２％")
    expect(record.yakka_code).to eq("2325003B2029")
  end

  it "replaces existing data wholesale" do
    Master::Medicine.create!(medicine_code: "stale")

    described_class.call(sample_file)

    expect(Master::Medicine.where(medicine_code: "stale")).not_to exist
    expect(Master::Medicine.count).to eq(3)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::Medicine.create!(medicine_code: "kept")

    bad_file = StringIO.new("a,b,c\n".encode("CP932"))

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::Medicine.count).to eq(1)
  end
end
