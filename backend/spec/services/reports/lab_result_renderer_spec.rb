require "rails_helper"
require "pdf/inspector"

# 同梱レイアウトで実際に PDF が組めること、左右 2 段・改ページの割り付けを実 PDF で見る。
RSpec.describe Reports::LabResultRenderer do
  let(:patient) do
    { "birthDate" => "1990-01-01", "gender" => "male",
      "name" => [{ "family" => "テスト", "given" => ["太郎"] }], "identifier" => [{ "value" => "2" }] }
  end
  let(:summary) do
    LabResultReport::Summary.new(date: "2026/09/07", setting: "外来", department: "内科", status: "最終報告",
                                 issued: "2026/09/07 12:00", conclusion: "総合所見の本文")
  end

  def line(name, note: "")
    LabResultReport::Line.new(name: name, value: "1.0", flag: "H", unit: "mg/dL", range: "0.5〜0.9", note: note)
  end

  def render(groups)
    described_class.new(layout_path: LabResultReport::LAYOUT_PATH, patient: patient,
                        organization: { "name" => "テスト病院" }, summary: summary, groups: groups,
                        printed_at: FacilityClock::ZONE.parse("2026-10-17 14:00")).render
  end

  # ThinReports は空白を NBSP で刷るので、照合しやすいよう普通の空白に戻す。
  def page_texts(pdf) = PDF::Inspector::Text.analyze(pdf).strings.join.tr("\u00A0", " ")
  def pages(pdf) = PDF::Inspector::Page.analyze(pdf).pages.map { |page| page[:strings].join.tr("\u00A0", " ") }

  it "fills the header and lines without the specimen" do
    pdf = render([LabResultReport::Group.new(category: "生化学検査", lines: [line("AST", note: "溶血")])])
    expect(pdf).to start_with("%PDF-")
    texts = page_texts(pdf)
    expect(texts).to include("太郎").and include("テスト病院").and include("2026/09/07")
    expect(texts).to include("生化学検査").and include("AST").and include("0.5〜0.9").and include("溶血")
    expect(texts).to include("総合所見").and include("総合所見の本文")
    expect(texts).to include("印刷 2026/10/17 14:00")
  end

  it "flows lines into two columns per page and repeats the category at the column head" do
    # 1 段 52 行。見出し 1 + 項目 150 + 総合所見 2 で 3 段 = 2 ページになる。
    lines = (1..150).map { |n| line(format("ITEM%03d", n)) }
    pdf = render([LabResultReport::Group.new(category: "生化学検査", lines: lines)])

    texts = pages(pdf)
    expect(texts.size).to eq(2)
    expect(texts[0]).to include("ITEM001").and include("ITEM100")
    expect(texts[0].scan("生化学検査（続き）").size).to eq(1)
    expect(texts[1]).to include("ITEM150").and include("生化学検査（続き）").and include("総合所見の本文")
    expect(texts[1]).to include("2 / 2")
  end

  it "fills the left column to the bottom before moving to the right" do
    lines = (1..20).map { |n| line(format("ITEM%03d", n)) }
    pdf = render([LabResultReport::Group.new(category: "生化学検査", lines: lines)])

    texts = pages(pdf)
    expect(texts.size).to eq(1)
    expect(texts[0]).not_to include("生化学検査（続き）")
  end
end
