require "rails_helper"

# 上流アクセスは「オーダー read 1 本 + batch Bundle POST 1 本」の 2 往復であること、
# 検体・採取管ごとのグルーピングと番号の採番、失敗時の例外マッピングを検証する
# (PDF 描画自体は LabLabelRenderer が担うのでモックする)。
RSpec.describe LabLabelReport do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end

  let(:order) do
    {
      "resourceType" => "ServiceRequest",
      "id" => "o1",
      "category" => [
        { "coding" => [{ "system" => described_class::ORDER_TYPE_SYSTEM, "code" => "lab" }] }
      ],
      "subject" => { "reference" => "Patient/p1" },
      "authoredOn" => "2026-08-09"
    }
  end
  let(:patient) { { "resourceType" => "Patient", "id" => "p1" } }

  def item(id, number:, name:, abbreviation: nil, specimen: nil)
    codings = [{ "system" => described_class::ORDER_ITEM_SYSTEM, "code" => id, "display" => name }]
    if abbreviation
      codings << { "system" => described_class::ABBREVIATION_SYSTEM,
                   "code" => abbreviation, "display" => abbreviation }
    end
    resource = {
      "resourceType" => "ServiceRequest",
      "id" => id,
      "identifier" => [{ "system" => described_class::ITEM_NUMBER_SYSTEM, "value" => number.to_s }],
      "code" => { "coding" => codings },
      "basedOn" => [{ "reference" => "ServiceRequest/o1" }]
    }
    if specimen
      resource["contained"] = [
        {
          "resourceType" => "Specimen",
          "id" => "specimen",
          "type" => {
            "coding" => [{ "system" => described_class::JLAC11_SPECIMEN_SYSTEM,
                           "code" => specimen[:code], "display" => specimen[:name] }]
          },
          "container" => [
            { "type" => { "coding" => [{ "system" => described_class::CONTAINER_SYSTEM,
                                         "code" => specimen[:container],
                                         "display" => specimen[:container_name] }] } }
          ]
        }
      ]
      resource["specimen"] = [{ "reference" => "#specimen" }]
    end
    resource
  end

  def batch_entry(resource)
    { "response" => { "status" => "200 OK" }, "resource" => resource }
  end

  def stub_order(status: 200, body: order)
    stub_request(:get, "#{base_url}/ServiceRequest/o1")
      .to_return(status: status, body: body.to_json)
  end

  def stub_batch(items)
    searchset = {
      "resourceType" => "Bundle", "type" => "searchset",
      "entry" => items.map { |i| { "resource" => i } }
    }
    stub_request(:post, "#{base_url}/")
      .to_return(status: 200, body: {
        "resourceType" => "Bundle", "type" => "batch-response",
        "entry" => [batch_entry(searchset), batch_entry(patient)]
      }.to_json)
  end

  def create_layout!
    ReportLayout.create!(
      name: "検体ラベル",
      questionnaire_url: described_class::LAYOUT_CANONICAL,
      questionnaire_version: "",
      tlf: { items: [] }.to_json
    )
  end

  before { create_layout! }

  it "groups items by specimen, issues numbers, and renders one label per group" do
    stub_order
    stub_batch([
      item("i1", number: 1, name: "末梢血液一般検査", abbreviation: "CBC",
           specimen: { code: "212", name: "全血", container: "T03", container_name: "EDTA管" }),
      item("i3", number: 3, name: "AST(GOT)", abbreviation: "AST",
           specimen: { code: "250", name: "血清", container: "T01", container_name: "分離剤管" }),
      item("i2", number: 2, name: "総蛋白(TP)", abbreviation: "TP",
           specimen: { code: "250", name: "血清", container: "T01", container_name: "分離剤管" })
    ])

    captured = nil
    renderer = instance_double(Reports::LabLabelRenderer, render: "%PDF")
    expect(Reports::LabLabelRenderer).to receive(:new) do |args|
      captured = args
      renderer
    end

    expect(described_class.new("o1", gateway: gateway).generate).to eq("%PDF")

    labels = captured[:labels]
    expect(labels.map { |l| l[:group].specimen_code }).to eq(%w[212 250])
    # 明細番号順に項目が並ぶ(略称優先)。
    expect(labels[0][:group].item_labels).to eq(["CBC"])
    expect(labels[1][:group].item_labels).to eq(%w[TP AST])
    expect(labels[0][:group].container_code).to eq("T03")
    # 番号は発行記録から採番される。
    records = LabLabelRecord.order(:id)
    expect(records.map(&:specimen_code)).to contain_exactly("212", "250")
    expect(labels.map { |l| l[:number] }).to all(match(/\A\d{11}\z/))

    expect(
      a_request(:post, "#{base_url}/").with do |req|
        urls = JSON.parse(req.body)["entry"].map { |e| e.dig("request", "url") }
        urls == ["ServiceRequest?based-on=ServiceRequest/o1&_count=100", "Patient/p1"]
      end
    ).to have_been_made.once
  end

  it "reuses the same numbers on reprint" do
    stub_order
    stub_batch([
      item("i1", number: 1, name: "末梢血液一般検査",
           specimen: { code: "212", name: "全血", container: "T03", container_name: "EDTA管" })
    ])
    allow(Reports::LabLabelRenderer).to receive(:new)
      .and_return(instance_double(Reports::LabLabelRenderer, render: "%PDF"))

    described_class.new("o1", gateway: gateway).generate
    first_numbers = LabLabelRecord.pluck(:label_number)
    described_class.new("o1", gateway: gateway).generate

    expect(LabLabelRecord.pluck(:label_number)).to eq(first_numbers)
  end

  it "raises NotFound when the order does not exist" do
    stub_order(status: 404, body: {})

    expect { described_class.new("o1", gateway: gateway).generate }
      .to raise_error(described_class::NotFound)
  end

  it "raises NotLabOrder for a non-lab ServiceRequest" do
    stub_order(body: order.merge("category" => []))

    expect { described_class.new("o1", gateway: gateway).generate }
      .to raise_error(described_class::NotLabOrder)
  end

  it "raises NoLabelTarget when the order has no items" do
    stub_order
    stub_batch([])

    expect { described_class.new("o1", gateway: gateway).generate }
      .to raise_error(described_class::NoLabelTarget)
  end

  it "raises LayoutNotRegistered without touching upstream when no layout exists" do
    ReportLayout.delete_all

    expect { described_class.new("o1", gateway: gateway).generate }
      .to raise_error(described_class::LayoutNotRegistered)
    expect(a_request(:get, "#{base_url}/ServiceRequest/o1")).not_to have_been_made
  end
end
