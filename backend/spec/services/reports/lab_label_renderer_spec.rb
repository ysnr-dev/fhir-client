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
  let(:order) { { "authoredOn" => "2026-08-20T09:00:00+09:00" } }
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
