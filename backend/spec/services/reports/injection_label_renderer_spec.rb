require "rails_helper"
require "pdf/inspector"

RSpec.describe Reports::InjectionLabelRenderer do
  let(:order) do
    { "authoredOn" => "2026-08-29T17:05:10+09:00",
      "occurrenceDateTime" => "2026-08-30",
      "category" => [{ "coding" => [{ "system" => InjectionReport::INJECTION_CATEGORY_SYSTEM, "code" => "emergency" }] }] }
  end
  let(:patient) do
    { "birthDate" => "1990-01-01", "gender" => "male",
      "name" => [{ "family" => "テスト", "given" => ["太郎"] }], "identifier" => [{ "value" => "2" }] }
  end

  def rp(number, names, times: [])
    InjectionReport::RpGroup.new(
      rp_number: number, usage_type: "点滴", route: "静脈内", site: "", method: "", line: "", rate: 100,
      start_times: times, usage_comment: "",
      medicines: names.each_with_index.map do |name, i|
        InjectionReport::MedicineLine.new(order_in_rp: i + 1, name: name, dose: 1, unit: "袋", comment: nil)
      end
    )
  end

  it "prints one label page per RP" do
    pdf = described_class.new(layout_path: InjectionReport::LABEL_LAYOUT_PATH, order: order, patient: patient,
                              rps: [rp(1, %w[生理食塩液 KCL], times: ["10:00"]), rp(2, ["セファゾリン"])]).render
    pages = PDF::Inspector::Page.analyze(pdf).pages.map { |p| p[:strings].join }
    expect(pages.size).to eq(2)
    # スペースを含まない断片で照合する(字送りとして消えることがある)。
    expect(pages[0]).to include("RP1").and include("生理食塩液").and include("KCL").and include("10:00")
    expect(pages[1]).to include("RP2").and include("セファゾリン")
    expect(pages[0]).to include("太郎")
    # 注射日は occurrenceDateTime。登録日時(authoredOn)の日付ではない。
    expect(pages[0]).to include("2026/08/30")
    expect(pages[0]).not_to include("2026/08/29")
  end

  it "falls back to the authoredOn day when the order has no occurrenceDateTime" do
    order.delete("occurrenceDateTime")
    pdf = described_class.new(layout_path: InjectionReport::LABEL_LAYOUT_PATH, order: order, patient: patient,
                              rps: [rp(1, %w[生理食塩液])]).render
    page = PDF::Inspector::Page.analyze(pdf).pages[0][:strings].join
    expect(page).to include("2026/08/29")
  end
end
