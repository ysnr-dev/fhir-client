require "rails_helper"

RSpec.describe MasterImport::MedicalProcedureImporter do
  def sample_file
    File.open(Rails.root.join("spec/fixtures/files/medical_procedures_sample.csv"), "rb")
  end

  it "declares exactly the 150 columns of the record layout" do
    expect(described_class.columns.size).to eq(150)
    expect(described_class.columns.uniq.size).to eq(described_class.columns.size)
  end

  it "imports all rows and maps columns correctly" do
    result = described_class.call(sample_file)

    expect(result.imported_count).to eq(4)
    expect(Master::MedicalProcedure.count).to eq(4)

    first_visit = Master::MedicalProcedure.find_by(procedure_code: "111000110")
    expect(first_visit.name).to eq("初診料")
    expect(first_visit.name_kana).to eq("ｼｮｼﾝﾘｮｳ")
    expect(first_visit.point_type).to eq("3")
    expect(first_visit.points).to eq(291.00)
    expect(first_visit.code_table_number_alpha).to eq("A")
    expect(first_visit.changed_on).to eq("20260601")
    expect(first_visit.abolished_on).to eq("99999999")
    expect(first_visit.publication_order).to eq("000230000")
    expect(first_visit.basic_name).to eq("初診料")
  end

  it "maps the trailing repeat blocks (施設基準・年齢加算) to the numbered columns" do
    described_class.call(sample_file)

    # 初診料は年齢加算①に注加算診療行為コードを持つ(乳幼児加算)。
    first_visit = Master::MedicalProcedure.find_by(procedure_code: "111000110")
    expect(first_visit.age_addition_procedure_code_1).to eq("111000370")
    expect(first_visit.age_addition_lower_age_1).to eq("00")
    expect(first_visit.age_addition_upper_age_1).to eq("06")
    # 未使用の繰り返し部分はゼロ埋めで届く。
    expect(first_visit.facility_standard_code_1).to eq("0")
  end

  it "keeps the きざみ値 block of a per-image procedure" do
    described_class.call(sample_file)

    # 単純撮影（イ）の写真診断は 2〜5 枚目が逓減(きざみ点数 42.50)。
    diagnosis = Master::MedicalProcedure.find_by(procedure_code: "170000410")
    expect(diagnosis.points).to eq(85.00)
    expect(diagnosis.increment_calc_type).to eq("1")
    expect(diagnosis.increment_lower_limit).to eq("1")
    expect(diagnosis.increment_upper_limit).to eq("5")
    expect(diagnosis.increment_points).to eq(42.50)
    expect(diagnosis.data_standard_name).to eq("枚")
  end

  it "fills the normalized search columns (insert_all! はコールバックを通らないため)" do
    described_class.call(sample_file)

    record = Master::MedicalProcedure.find_by(procedure_code: "170000410")
    expect(record.search_name).to be_present
    expect(record.search_kana).to be_present
  end

  it "replaces existing data wholesale" do
    Master::MedicalProcedure.create!(procedure_code: "stale")

    described_class.call(sample_file)

    expect(Master::MedicalProcedure.where(procedure_code: "stale")).not_to exist
    expect(Master::MedicalProcedure.count).to eq(4)
  end

  it "rolls back entirely when a row has the wrong number of columns" do
    Master::MedicalProcedure.create!(procedure_code: "kept")

    bad_file = StringIO.new("a,b,c\n".encode("CP932"))

    expect { described_class.call(bad_file) }.to raise_error(MasterImport::ImportError)
    expect(Master::MedicalProcedure.count).to eq(1)
  end
end
