require "rails_helper"

RSpec.describe MasterImport::HolidayImporter do
  # 内閣府 syukujitsu.csv と同じ形(Shift_JIS、ヘッダあり、2027/1/1 形式)の 3 行。
  let(:file) { fixture_file_upload("holidays_sample.csv") }

  it "国民の祝日として取り込む" do
    result = described_class.call(file)

    expect(result.imported_count).to eq(3)
    holiday = Master::Holiday.find_by(holiday_date: Date.new(2027, 1, 11))
    expect(holiday.name).to eq("成人の日")
    expect(holiday.kind).to eq("national")
  end

  it "ファイルが覆う期間の祝日だけを入れ替え、休診日は残す" do
    Master::Holiday.create!(holiday_date: Date.new(2027, 2, 1), name: "古い祝日", kind: "national")
    Master::Holiday.create!(holiday_date: Date.new(2026, 11, 3), name: "文化の日", kind: "national")
    Master::Holiday.create!(holiday_date: Date.new(2027, 1, 2), name: "年始休診", kind: "facility")

    described_class.call(file)

    expect(Master::Holiday.order(:holiday_date).pluck(:name))
      .to eq(%w[文化の日 元日 年始休診 成人の日 休日])
  end

  it "休診日と同じ日の祝日は取り込まない" do
    Master::Holiday.create!(holiday_date: Date.new(2027, 1, 1), name: "年始休診", kind: "facility")

    result = described_class.call(file)

    expect(result.imported_count).to eq(2)
    expect(result.skipped_count).to eq(1)
    expect(Master::Holiday.find_by(holiday_date: Date.new(2027, 1, 1)).name).to eq("年始休診")
  end

  it "日付が読めない行は取込全体を止める" do
    bad = Rack::Test::UploadedFile.new(
      StringIO.new("月日,名称\n2027-01-01,元日\n".encode("CP932")), "text/csv", original_filename: "bad.csv"
    )
    expect { described_class.call(bad) }.to raise_error(MasterImport::ImportError, /日付/)
  end
end
