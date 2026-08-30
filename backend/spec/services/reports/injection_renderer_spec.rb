require "rails_helper"
require "pdf/inspector"

# 同梱レイアウトで実際に PDF が組めること、続紙の境界(lines_per_page)が .tlf の
# 内容欄と合っていることを実 PDF で見る(処方箋の renderer spec と同じ理由)。
RSpec.describe Reports::InjectionRenderer do
  let(:order) do
    {
      "authoredOn" => "2026-09-01",
      "category" => [
        { "coding" => [{ "system" => InjectionReport::SETTING_SYSTEM, "code" => "inpatient", "display" => "入院" }] },
        { "coding" => [{ "system" => InjectionReport::INJECTION_CATEGORY_SYSTEM, "code" => "regular", "display" => "定時" }] }
      ],
      "requester" => { "display" => "児玉 義憲" },
      "extension" => [
        { "url" => InjectionReport::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "display" => "内科" } },
        { "url" => InjectionReport::ORDER_WARD_EXT_URL, "valueReference" => { "display" => "東3階病棟" } },
        { "url" => InjectionReport::SERIES_START_EXT_URL, "valueDate" => "2026-08-30" }
      ],
      "note" => [{ "text" => "注射コメント" }]
    }
  end
  let(:patient) do
    { "birthDate" => "1990-01-01", "gender" => "male",
      "name" => [{ "family" => "テスト", "given" => ["太郎"] }], "identifier" => [{ "value" => "2" }] }
  end

  def rp(number, medicines:, times: [], rate: nil)
    InjectionReport::RpGroup.new(
      rp_number: number, usage_type: "点滴", route: "静脈内", site: "", method: "静脈注射", line: "",
      rate: rate, start_times: times, usage_comment: "",
      medicines: medicines.each_with_index.map do |(name, dose, unit), index|
        InjectionReport::MedicineLine.new(order_in_rp: index + 1, name: name, dose: dose, unit: unit, comment: nil)
      end
    )
  end

  def render(rps)
    layout = InjectionReport::ORDER_LAYOUT
    described_class.new(layout_path: layout[:path], order: order, patient: patient,
                        organization: { "name" => "テスト病院" }, rps: rps,
                        lines_per_page: layout[:lines_per_page], max_cols: layout[:max_cols]).render
  end

  def page_texts(pdf) = PDF::Inspector::Page.analyze(pdf).pages.map { |page| page[:strings] }

  it "produces a PDF with the order values filled in" do
    pdf = render([rp(1, medicines: [["生理食塩液", 1, "袋"]], times: %w[10:00 20:30], rate: 100)])
    expect(pdf).to start_with("%PDF-")
    texts = page_texts(pdf)[0].join
    # スペースは字送りとして消えることがあるので、スペースを含まない断片で照合する
    # (処方箋の renderer spec と同じ)。
    expect(texts).to include("太郎").and include("2026/09/01").and include("東3階病棟")
    expect(texts).to include("生理食塩液").and include("100mL/h").and include("10:00")
    # 連日 3 日目(9/1 は 8/30 開始の 3 日目)。
    expect(texts).to include("3日目")
    expect(page_texts(pdf).size).to eq(1)
  end

  it "starts a continuation page when the content exceeds lines_per_page" do
    lines = InjectionReport::ORDER_LAYOUT[:lines_per_page]
    # 1 RP = 見出し 1 行 + 薬剤 n 行。1 ページに収まる直前と直後で境界を見る。
    fits = render([rp(1, medicines: Array.new(lines - 1) { |i| ["薬剤#{i}", 1, "A"] })])
    overflow = render([rp(1, medicines: Array.new(lines) { |i| ["薬剤#{i}", 1, "A"] })])
    expect(page_texts(fits).size).to eq(1)
    expect(page_texts(overflow).size).to eq(2)
    expect(page_texts(overflow)[1].join).to include("薬剤#{lines - 1}")
  end
end
