require "rails_helper"

# 上流アクセスは「オーダー read 1 本 + batch Bundle POST 1 本(+ 新規の管ぶんの
# Specimen 作成)」であること、検体・採取管ごとのグルーピング、台帳としての
# Specimen の扱い(再発行は既存の番号、新規は conditional create)、失敗時の
# 例外マッピングを検証する(PDF 描画は LabLabelRenderer が担うのでモックする)。
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

  # 発行済みの管(台帳としての Specimen)。
  def label_specimen(id, number:, specimen_code:)
    {
      "resourceType" => "Specimen",
      "id" => id,
      "accessionIdentifier" => { "system" => described_class::LABEL_NUMBER_SYSTEM, "value" => number },
      "type" => { "coding" => [{ "system" => described_class::JLAC11_SPECIMEN_SYSTEM,
                                 "code" => specimen_code }] },
      "request" => [{ "reference" => "ServiceRequest/o1" }]
    }
  end

  def batch_entry(resource)
    { "response" => { "status" => "200 OK" }, "resource" => resource }
  end

  def searchset(resources)
    { "resourceType" => "Bundle", "type" => "searchset",
      "entry" => resources.map { |r| { "resource" => r } } }
  end

  def stub_order(status: 200, body: order)
    stub_request(:get, "#{base_url}/ServiceRequest/o1")
      .to_return(status: status, body: body.to_json)
  end

  def stub_batch(items, specimens: [])
    stub_request(:post, "#{base_url}/")
      .to_return(status: 200, body: {
        "resourceType" => "Bundle", "type" => "batch-response",
        "entry" => [batch_entry(searchset(items)), batch_entry(patient),
                    batch_entry(searchset(specimens))]
      }.to_json)
  end

  # Specimen の conditional create。上流の採番(Fhir::AccessionAssigner)を模して、
  # 値なしの accessionIdentifier に 11 桁の番号を埋めて返す。
  def stub_specimen_create
    counter = 0
    stub_request(:post, "#{base_url}/Specimen")
      .to_return do |request|
        body = JSON.parse(request.body)
        counter += 1
        body["accessionIdentifier"]["value"] ||= format("%011d", counter)
        { status: 201, body: body.to_json }
      end
  end

  it "groups items by specimen and creates one label Specimen per new tube" do
    stub_order
    stub_batch([
      item("i1", number: 1, name: "末梢血液一般検査", abbreviation: "CBC",
           specimen: { code: "212", name: "全血", container: "T03", container_name: "EDTA管" }),
      item("i3", number: 3, name: "AST(GOT)", abbreviation: "AST",
           specimen: { code: "250", name: "血清", container: "T01", container_name: "分離剤管" }),
      item("i2", number: 2, name: "総蛋白(TP)", abbreviation: "TP",
           specimen: { code: "250", name: "血清", container: "T01", container_name: "分離剤管" })
    ])
    create = stub_specimen_create

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
    expect(labels.map { |l| l[:number] }).to all(match(/\A\d{11}\z/))
    expect(labels.map { |l| l[:number] }.uniq.length).to eq(2)

    # 管 1 本 = Specimen 1 件。二重発行対策の conditional create で作られる。
    expect(create).to have_been_requested.twice
    expect(
      a_request(:post, "#{base_url}/Specimen").with(
        headers: { "If-None-Exist" => "request=ServiceRequest/o1&type=212" }
      ) { |req|
        body = JSON.parse(req.body)
        # 番号は送らない(上流が作成時に採番する)。
        body.dig("accessionIdentifier", "system") == described_class::LABEL_NUMBER_SYSTEM &&
          body.dig("accessionIdentifier", "value").nil? &&
          body["request"] == [{ "reference" => "ServiceRequest/o1" }] &&
          body.dig("subject", "reference") == "Patient/p1" &&
          body["status"].nil?
      }
    ).to have_been_made.once
  end

  it "reuses the numbers of already issued Specimens (reprint creates nothing)" do
    stub_order
    stub_batch(
      [item("i1", number: 1, name: "末梢血液一般検査",
            specimen: { code: "212", name: "全血", container: "T03", container_name: "EDTA管" })],
      specimens: [label_specimen("sp1", number: "00000000456", specimen_code: "212")]
    )
    create = stub_specimen_create

    captured = nil
    allow(Reports::LabLabelRenderer).to receive(:new) do |args|
      captured = args
      instance_double(Reports::LabLabelRenderer, render: "%PDF")
    end

    described_class.new("o1", gateway: gateway).generate

    expect(captured[:labels].map { |l| l[:number] }).to eq(["00000000456"])
    expect(create).not_to have_been_requested
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

  it "renders with the bundled layout file (no DB registration involved)" do
    stub_order
    stub_batch([item("i1", number: 1, name: "末梢血液一般検査", abbreviation: "CBC",
                     specimen: { code: "212", name: "全血", container: "T03", container_name: "EDTA管" })])
    stub_specimen_create

    captured = nil
    renderer = instance_double(Reports::LabLabelRenderer, render: "%PDF")
    expect(Reports::LabLabelRenderer).to receive(:new) do |args|
      captured = args
      renderer
    end

    described_class.new("o1", gateway: gateway).generate

    expect(captured[:layout_path]).to eq(described_class::LAYOUT_PATH)
    expect(described_class::LAYOUT_PATH).to exist
  end
end
