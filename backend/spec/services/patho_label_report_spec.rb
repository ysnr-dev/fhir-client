require "rails_helper"

# 病理検体ラベル: 容器数ぶんのラベル(オーダー通しの容器番号)、台帳としての Specimen の扱い
# (新規は conditional create、再発行は既存の番号、容器数を減らしたら取り下げ・戻したら復帰)、
# 失敗時の例外を検証する。描画は最後の 1 件だけ同梱のレイアウトで実際に行う。
RSpec.describe PathoLabelReport do
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
        { "coding" => [{ "system" => described_class::ORDER_TYPE_SYSTEM, "code" => "pathology" }] }
      ],
      "code" => { "coding" => [{ "system" => described_class::EXAM_CATEGORY_SYSTEM, "code" => "N000",
                                 "display" => "組織診" }] },
      "priority" => "urgent",
      "subject" => { "reference" => "Patient/p1" },
      "authoredOn" => "2026-11-01T09:00:00+09:00",
      "occurrenceDateTime" => "2026-11-01T14:00:00+09:00"
    }
  end
  let(:patient) do
    { "resourceType" => "Patient", "id" => "p1", "identifier" => [{ "value" => "2" }],
      "name" => [{ "family" => "テスト", "given" => ["太郎"] }], "gender" => "male", "birthDate" => "1990-01-01" }
  end

  def item(id, number:, organ:, containers: nil, pieces: nil, collected: nil)
    specimen = {
      "resourceType" => "Specimen", "id" => "specimen",
      "type" => { "coding" => [{ "system" => described_class::SPECIMEN_TYPE_SYSTEM, "code" => "201",
                                 "display" => "生検" }] },
      "collection" => {
        "bodySite" => { "text" => organ,
                        "coding" => [{ "system" => described_class::ORGAN_SYSTEM, "code" => "x", "display" => organ }] }
      }
    }
    specimen["collection"]["quantity"] = { "value" => pieces, "unit" => "個" } if pieces
    specimen["collection"]["collectedDateTime"] = collected if collected
    if containers
      specimen["extension"] = [{ "url" => described_class::CONTAINER_COUNT_EXT_URL, "valueInteger" => containers }]
    end
    {
      "resourceType" => "ServiceRequest", "id" => id,
      "identifier" => [{ "system" => described_class::ITEM_NUMBER_SYSTEM, "value" => number.to_s }],
      "basedOn" => [{ "reference" => "ServiceRequest/o1" }],
      "contained" => [specimen],
      "specimen" => [{ "reference" => "#specimen" }]
    }
  end

  def container(id, key:, number:, status: nil)
    resource = {
      "resourceType" => "Specimen", "id" => id,
      "identifier" => [{ "system" => described_class::PATHO_CONTAINER_SYSTEM, "value" => key }],
      "accessionIdentifier" => { "system" => described_class::LABEL_NUMBER_SYSTEM, "value" => number },
      "request" => [{ "reference" => "ServiceRequest/o1" }]
    }
    resource["status"] = status if status
    resource
  end

  let(:search_path) do
    "#{base_url}/ServiceRequest?_id=o1&_include=ServiceRequest%3Asubject" \
      "&_revinclude=ServiceRequest%3Abased-on&_revinclude=Specimen%3Arequest"
  end

  def stub_search(items = [], specimens: [], order_body: order)
    resources = [order_body].compact + [patient] + items + specimens
    body = { "resourceType" => "Bundle", "type" => "searchset", "entry" => resources.map { |r| { "resource" => r } } }
    stub_request(:get, search_path).to_return(status: 200, body: body.to_json)
  end

  # 上流の採番を模して、値なしの accessionIdentifier に番号を埋めて返す。PUT はそのまま返す。
  def stub_batch
    counter = 100
    stub_request(:post, "#{base_url}/").to_return do |request|
      entries = JSON.parse(request.body)["entry"].map do |entry|
        resource = entry["resource"]
        if entry.dig("request", "method") == "POST"
          counter += 1
          resource["accessionIdentifier"]["value"] ||= format("%011d", counter)
        end
        { "response" => { "status" => "200 OK" }, "resource" => resource }
      end
      { status: 200, body: { "resourceType" => "Bundle", "type" => "batch-response", "entry" => entries }.to_json }
    end
  end

  def capture_labels
    captured = nil
    allow(Reports::PathoLabelRenderer).to receive(:new) do |args|
      captured = args
      instance_double(Reports::PathoLabelRenderer, render: "%PDF")
    end
    -> { captured[:labels] }
  end

  def batch_entries
    bodies = []
    expect(a_request(:post, "#{base_url}/").with { |req| bodies << JSON.parse(req.body)["entry"] }).to have_been_made
    bodies.last
  end

  it "prints one label per container numbered across the order and creates the containers" do
    stub_search([
      item("i2", number: 2, organ: "胃体部"),
      item("i1", number: 1, organ: "右 胃前庭部", containers: 2, pieces: 3, collected: "2026-11-01T10:31:00+09:00")
    ])
    stub_batch
    labels = capture_labels

    described_class.new("o1", gateway: gateway).generate

    result = labels.call
    expect(result.map { |l| [l.specimen_number, l.container_number, l.container_total] })
      .to eq([["1", 1, 3], ["1", 2, 3], ["2", 3, 3]])
    expect(result.first.organ).to eq("右 胃前庭部")
    expect(result.first.detail).to eq("組織診・生検・3個")
    expect(result.map(&:number)).to eq(%w[00000000101 00000000102 00000000103])

    entries = batch_entries
    expect(entries.map { |e| e.dig("request", "ifNoneExist") }).to eq([
      "identifier=#{CGI.escape(described_class::PATHO_CONTAINER_SYSTEM)}%7Ci1%3A1",
      "identifier=#{CGI.escape(described_class::PATHO_CONTAINER_SYSTEM)}%7Ci1%3A2",
      "identifier=#{CGI.escape(described_class::PATHO_CONTAINER_SYSTEM)}%7Ci2%3A1"
    ])
    first = entries.first["resource"]
    expect(first["request"]).to eq([{ "reference" => "ServiceRequest/o1" }, { "reference" => "ServiceRequest/i1" }])
    expect(first.dig("accessionIdentifier", "value")).to be_nil
  end

  it "reuses issued numbers and creates nothing on reprint" do
    stub_search([item("i1", number: 1, organ: "胃前庭部")],
                specimens: [container("s1", key: "i1:1", number: "00000000456")])
    batch = stub_batch
    labels = capture_labels

    described_class.new("o1", gateway: gateway).generate

    expect(labels.call.map(&:number)).to eq(["00000000456"])
    expect(batch).not_to have_been_requested
  end

  it "retires containers that are no longer counted and revives ones counted again" do
    stub_search([item("i1", number: 1, organ: "胃前庭部", containers: 2)],
                specimens: [container("s1", key: "i1:1", number: "00000000001"),
                            container("s2", key: "i1:2", number: "00000000002", status: "entered-in-error"),
                            container("s3", key: "i1:3", number: "00000000003")])
    stub_batch
    labels = capture_labels

    described_class.new("o1", gateway: gateway).generate

    expect(labels.call.map(&:number)).to eq(%w[00000000001 00000000002])
    entries = batch_entries
    expect(entries.map { |e| [e.dig("request", "url"), e.dig("resource", "status")] })
      .to eq([["Specimen/s2", nil], ["Specimen/s3", "entered-in-error"]])
  end

  it "raises NotPathoOrder for a non-pathology order" do
    stub_search(order_body: order.merge("category" => []))
    expect { described_class.new("o1", gateway: gateway).generate }.to raise_error(described_class::NotPathoOrder)
  end

  it "raises NoLabelTarget when the order has no specimens" do
    stub_search([])
    expect { described_class.new("o1", gateway: gateway).generate }.to raise_error(described_class::NoLabelTarget)
  end

  it "raises UpstreamError when a container create fails" do
    stub_search([item("i1", number: 1, organ: "胃前庭部")])
    stub_request(:post, "#{base_url}/").to_return(status: 200, body: {
      "resourceType" => "Bundle", "type" => "batch-response",
      "entry" => [{ "response" => { "status" => "422 Unprocessable Content" } }]
    }.to_json)
    expect { described_class.new("o1", gateway: gateway).generate }.to raise_error(described_class::UpstreamError)
  end

  it "renders a PDF with the bundled layout" do
    stub_search([item("i1", number: 1, organ: "胃前庭部", containers: 2)])
    stub_batch

    pdf = described_class.new("o1", gateway: gateway).generate

    expect(pdf).to start_with("%PDF")
    expect(described_class::LAYOUT_PATH).to exist
  end
end
