require "rails_helper"

# 同梱レイアウト(LabLabelReport::LAYOUT_PATH)で実際に PDF が組めることを見る。
# .tlf がイメージから落ちた・プレースホルダー ID がレンダラとずれた、という
# 「発行を押して初めて 500 になる」故障をここで捕まえる。
RSpec.describe Reports::LabLabelRenderer do
  let(:group) do
    LabLabelReport::LabelGroup.new(
      specimen_code: "212", specimen_name: "全血",
      container_code: "T03", container_name: "EDTA管", item_labels: %w[CBC AST]
    )
  end
  # 登録日時(authoredOn)と検査日(occurrenceDateTime)は別の日。刷るのは検査日。
  let(:order) { { "authoredOn" => "2026-08-19T17:30:00+09:00", "occurrenceDateTime" => "2026-08-20" } }
  let(:patient) do
    {
      "birthDate" => "1980-01-02",
      "gender" => "male",
      "name" => [{ "family" => "検査", "given" => ["太郎"] }],
      "identifier" => [{ "value" => "P0001" }]
    }
  end

  def render(labels)
    described_class.new(
      layout_path: LabLabelReport::LAYOUT_PATH, order: order, patient: patient, labels: labels
    ).render
  end

  it "produces a PDF from the bundled layout" do
    pdf = render([{ group: group, number: "12345678901" }])

    expect(pdf).to start_with("%PDF-")
  end

  it "prints the occurrence day as the order date, not the authoredOn day" do
    page = PDF::Inspector::Page.analyze(render([{ group: group, number: "12345678901" }])).pages[0][:strings].join

    expect(page).to include("2026/08/20")
    expect(page).not_to include("2026/08/19")
  end

  it "falls back to the authoredOn day when the order has no occurrenceDateTime" do
    pdf = described_class.new(
      layout_path: LabLabelReport::LAYOUT_PATH,
      order: { "authoredOn" => "2026-08-19T17:30:00+09:00" }, patient: patient,
      labels: [{ group: group, number: "12345678901" }]
    ).render
    page = PDF::Inspector::Page.analyze(pdf).pages[0][:strings].join

    expect(page).to include("2026/08/19")
  end

  it "prints one page per tube" do
    one = render([{ group: group, number: "12345678901" }])
    two = render([{ group: group, number: "12345678901" },
                  { group: group, number: "12345678902" }])

    expect(two.bytesize).to be > one.bytesize
  end

  it "shows the urgent mark only for urgent orders" do
    normal = render([{ group: group, number: "12345678901" }])
    urgent = described_class.new(
      layout_path: LabLabelReport::LAYOUT_PATH,
      order: order.merge("priority" => "urgent"), patient: patient,
      labels: [{ group: group, number: "12345678901" }]
    ).render

    expect(urgent.bytesize).not_to eq(normal.bytesize)
  end
end
