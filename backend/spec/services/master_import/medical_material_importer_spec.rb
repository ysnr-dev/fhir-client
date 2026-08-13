require "rails_helper"

RSpec.describe MasterImport::MedicalMaterialImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/medical_materials_sample.csv"), "rb")
  end

  it "imports all rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(4)
    expect(Master::MedicalMaterial.count).to eq(4)

    film = Master::MedicalMaterial.find_by(material_code: "700010000")
    expect(film.name).to eq("半切")
    expect(film.name_kana).to eq("ﾊﾝｾﾂ")
    expect(film.unit_code).to eq("6")
    expect(film.unit_name).to eq("枚")
    expect(film.price).to eq(120.00)
    expect(film.basic_name).to eq("フィルム・半切")
    expect(film.publication_order).to eq("982000")
    expect(film.changed_on).to eq("20240601")
    expect(film.abolished_on).to eq("99999999")
    expect(film.notification_table_number).to eq("3")
  end

  it "keeps materials whose unit is not set (単位コードが 0 の器材)" do
    described_class.call(sample_file)

    catheter = Master::MedicalMaterial.find_by(material_code: "710010004")
    expect(catheter.name).to eq("中心静脈用カテーテル（標準・シングルルーメン）")
    expect(catheter.unit_name).to be_blank
    expect(catheter.price).to eq(1790.00)
    expect(catheter.basic_name).to eq("中心静脈用カテーテル・標準型・シングルルーメン")
  end

  it "fills the normalized search columns (insert_all! はコールバックを通らないため)" do
    described_class.call(sample_file)

    catheter = Master::MedicalMaterial.find_by(material_code: "710010004")
    expect(catheter.search_name).to be_present
    expect(catheter.search_kana).to be_present
  end

  it "replaces existing data wholesale" do
    Master::MedicalMaterial.create!(material_code: "stale")

    described_class.call(sample_file)

    expect(Master::MedicalMaterial.where(material_code: "stale")).not_to exist
    expect(Master::MedicalMaterial.count).to eq(4)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::MedicalMaterial.create!(material_code: "kept")

    bad_file = StringIO.new("a,b,c\n".encode("CP932"))

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::MedicalMaterial.count).to eq(1)
  end
end
