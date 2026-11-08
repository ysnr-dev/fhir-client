require "rails_helper"
require "pdf/inspector"

# 同梱レイアウトで実際に PDF が組めること、長文の折り返しと改ページの割り付けを実 PDF で見る。
RSpec.describe Reports::DischargeSummaryRenderer do
  let(:patient) do
    { "birthDate" => "1990-01-01", "gender" => "male",
      "name" => [{ "family" => "テスト", "given" => ["太郎"] }], "identifier" => [{ "value" => "2" }] }
  end
  let(:admission) do
    DischargeSummaryReport::Admission.new(admitted: "2026/08/25", discharged: "2026/09/17", stay_days: 24,
                                          department: "内科", attending: "児玉 義憲", disposition: "自宅")
  end
  let(:record) do
    DischargeSummaryReport::Record.new(recorded_at: "2026/09/17 22:29", status: "確定", author: "児玉 義憲",
                                       attester: "児玉 義憲", attested_at: "2026/09/17 22:30", department: "内科")
  end

  def section(title, paragraphs) = DischargeSummaryReport::Section.new(title:, paragraphs:)

  def render(sections)
    described_class.new(layout_path: DischargeSummaryReport::LAYOUT_PATH, patient: patient,
                        organization: { "name" => "テスト病院" }, admission: admission, record: record,
                        sections: sections, printed_at: FacilityClock::ZONE.parse("2026-11-08 14:00")).render
  end

  # ThinReports は空白を NBSP で刷るので、照合しやすいよう普通の空白に戻す。
  def pages(pdf) = PDF::Inspector::Page.analyze(pdf).pages.map { |page| page[:strings].join.tr(" ", " ") }

  it "fills the header, the admission and the sections" do
    pdf = render([section("入院経過", ["08/25 入院 東3階病棟", "09/17 退院"]), section("アレルギー", ["なし"])])
    expect(pdf).to start_with("%PDF-")
    text = pages(pdf).join
    expect(text).to include("太郎").and include("テスト病院")
    expect(text).to include("入院 2026/08/25 〜 2026/09/17（24 日）").and include("主治医 児玉 義憲")
      .and include("転帰 自宅")
    expect(text).to include("確定 児玉 義憲 2026/09/17 22:30").and include("印刷 2026/11/08 14:00")
    expect(text).to include("入院経過").and include("09/17 退院").and include("アレルギー")
  end

  it "wraps long paragraphs by width without indenting the continuation" do
    strings = PDF::Inspector::Page.analyze(render([section("入院経過", ["あ" * 120])])).pages.first[:strings]
    # 全角 50 字(半角換算 100 桁)ずつの 3 行に分かれる。
    expect(strings.select { |string| string.start_with?("あ") }).to eq(["あ" * 50, "あ" * 50, "あ" * 20])
  end

  it "breaks pages and repeats the section title at the page head" do
    # 1 ページ 46 行。見出し 1 + 本文 100 行で 3 ページになる。
    lines = (1..100).map { |n| format("LINE%03d", n) }
    texts = pages(render([section("入院経過", lines)]))

    expect(texts.size).to eq(3)
    expect(texts[0]).to include("LINE001").and include("LINE045")
    expect(texts[1]).to include("入院経過（続き）").and include("LINE046")
    expect(texts[2]).to include("LINE100").and include("3 / 3")
  end

  it "prints one page for a summary without sections" do
    expect(pages(render([])).size).to eq(1)
  end
end
