require "rails_helper"

# 細菌検査の検体ラベル: 容器の組み立て(検体の容器 + 別容器の項目)、台帳としての Specimen の扱い
# (新規は conditional create、再発行は既存の番号、項目を外したら取り下げ・戻したら復帰)、
# 失敗時の例外を検証する。描画は最後の 1 件だけ同梱のレイアウトで実際に行う。
RSpec.describe MicroLabelReport do
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
        { "coding" => [{ "system" => described_class::ORDER_TYPE_SYSTEM, "code" => "micro" }] }
      ],
      "priority" => "urgent",
      "subject" => { "reference" => "Patient/p1" },
      "authoredOn" => "2026-11-05T09:00:00+09:00",
      "occurrenceDateTime" => "2026-11-05"
    }
  end
  let(:patient) do
    { "resourceType" => "Patient", "id" => "p1", "identifier" => [{ "value" => "2" }],
      "name" => [{ "family" => "テスト", "given" => ["太郎"] }], "gender" => "male", "birthDate" => "1990-01-01" }
  end

  before do
    Master::MicroOrderItem.create!(item_code: "1", name: "塗抹・鏡検", short_name: "塗抹")
    Master::MicroOrderItem.create!(item_code: "2", name: "培養・同定", short_name: "培養")
    Master::MicroOrderItem.create!(item_code: "8", name: "血液培養（好気ボトル）", separate_container: true)
    Master::MicroOrderItem.create!(item_code: "9", name: "血液培養（嫌気ボトル）", separate_container: true)
  end

  def group(id = "g1", type: "血液", site: "右 前腕", occurrence: "2026-11-05")
    specimen = {
      "resourceType" => "Specimen", "id" => "specimen",
      "type" => { "coding" => [{ "system" => described_class::SPECIMEN_TYPE_SYSTEM, "code" => "001",
                                 "display" => type }] },
      "collection" => {
        "bodySite" => { "text" => site },
        "method" => { "coding" => [{ "system" => described_class::COLLECTION_METHOD_SYSTEM, "code" => "1",
                                     "display" => "静脈採血" }] }
      }
    }
    {
      "resourceType" => "ServiceRequest", "id" => id,
      "identifier" => [{ "system" => described_class::ITEM_NUMBER_SYSTEM, "value" => "1" }],
      "basedOn" => [{ "reference" => "ServiceRequest/o1" }],
      "occurrenceDateTime" => occurrence,
      "contained" => [specimen],
      "specimen" => [{ "reference" => "#specimen" }]
    }
  end

  def item(id, code:, name:, number:)
    {
      "resourceType" => "ServiceRequest", "id" => id,
      "identifier" => [{ "system" => described_class::ITEM_NUMBER_SYSTEM, "value" => number.to_s }],
      "basedOn" => [{ "reference" => "ServiceRequest/g1" }],
      "code" => { "coding" => [{ "system" => described_class::ORDER_ITEM_SYSTEM, "code" => code, "display" => name }],
                  "text" => name }
    }
  end

  def container(id, key:, number:, status: nil)
    resource = {
      "resourceType" => "Specimen", "id" => id,
      "identifier" => [{ "system" => described_class::MICRO_CONTAINER_SYSTEM, "value" => key }],
      "accessionIdentifier" => { "system" => described_class::LABEL_NUMBER_SYSTEM, "value" => number },
      "request" => [{ "reference" => "ServiceRequest/o1" }]
    }
    resource["status"] = status if status
    resource
  end

  let(:search_path) do
    "#{base_url}/ServiceRequest?_id=o1&_include=ServiceRequest%3Asubject" \
      "&_revinclude%3Aiterate=ServiceRequest%3Abased-on&_revinclude=Specimen%3Arequest"
  end

  def stub_search(requests = [], specimens: [], order_body: order)
    resources = [order_body].compact + [patient] + requests + specimens
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
    allow(Reports::MicroLabelRenderer).to receive(:new) do |args|
      captured = args
      instance_double(Reports::MicroLabelRenderer, render: "%PDF")
    end
    -> { captured[:labels] }
  end

  def batch_entries
    bodies = []
    expect(a_request(:post, "#{base_url}/").with { |req| bodies << JSON.parse(req.body)["entry"] }).to have_been_made
    bodies.last
  end

  it "prints the specimen container and one label per bottle, and creates the containers" do
    stub_search([
      group,
      item("i9", code: "9", name: "血液培養（嫌気ボトル）", number: 4),
      item("i8", code: "8", name: "血液培養（好気ボトル）", number: 3),
      item("i2", code: "2", name: "培養・同定", number: 2)
    ])
    stub_batch
    labels = capture_labels

    described_class.new("o1", gateway: gateway).generate

    result = labels.call
    expect(result.map { |l| [l.key, l.container_number, l.container_total] })
      .to eq([["g1", 1, 3], ["i8", 2, 3], ["i9", 3, 3]])
    expect(result.map(&:specimen).uniq).to eq(["血液 右 前腕"])
    expect(result.map(&:detail)).to eq(["静脈採血 培養", "血液培養（好気ボトル）", "血液培養（嫌気ボトル）"])
    expect(result.map(&:number)).to eq(%w[00000000101 00000000102 00000000103])

    entries = batch_entries
    expect(entries.map { |e| e.dig("request", "ifNoneExist") }).to eq(
      %w[g1 i8 i9].map { |key| "identifier=#{CGI.escape(described_class::MICRO_CONTAINER_SYSTEM)}%7C#{key}" }
    )
    first, bottle = entries.map { |e| e["resource"] }
    expect(first["request"]).to eq([{ "reference" => "ServiceRequest/o1" }, { "reference" => "ServiceRequest/g1" }])
    expect(first.dig("type", "coding", 0, "code")).to eq("001")
    expect(first["container"]).to be_nil
    expect(bottle["container"]).to eq([{ "description" => "血液培養（好気ボトル）" }])
    expect(first.dig("accessionIdentifier", "value")).to be_nil
  end

  it "prints only the bottles when every item has its own container" do
    stub_search([group, item("i8", code: "8", name: "血液培養（好気ボトル）", number: 2)])
    stub_batch
    labels = capture_labels

    described_class.new("o1", gateway: gateway).generate

    expect(labels.call.map(&:key)).to eq(["i8"])
  end

  it "prints the specimen container for a specimen without items" do
    stub_search([group])
    stub_batch
    labels = capture_labels

    described_class.new("o1", gateway: gateway).generate

    expect(labels.call.map { |l| [l.key, l.detail] }).to eq([%w[g1 静脈採血]])
  end

  it "reuses issued numbers and creates nothing on reprint" do
    stub_search([group, item("i1", code: "1", name: "塗抹・鏡検", number: 2)],
                specimens: [container("s1", key: "g1", number: "00000000456")])
    batch = stub_batch
    labels = capture_labels

    described_class.new("o1", gateway: gateway).generate

    expect(labels.call.map(&:number)).to eq(["00000000456"])
    expect(batch).not_to have_been_requested
  end

  it "retires containers that are no longer ordered and revives ones ordered again" do
    stub_search([group, item("i8", code: "8", name: "血液培養（好気ボトル）", number: 2)],
                specimens: [container("s1", key: "g1", number: "00000000001"),
                            container("s2", key: "i8", number: "00000000002", status: "entered-in-error")])
    stub_batch
    labels = capture_labels

    described_class.new("o1", gateway: gateway).generate

    expect(labels.call.map(&:number)).to eq(["00000000002"])
    entries = batch_entries
    expect(entries.map { |e| [e.dig("request", "url"), e.dig("resource", "status")] })
      .to eq([["Specimen/s2", nil], ["Specimen/s1", "entered-in-error"]])
  end

  it "raises NotMicroOrder for a non-micro order" do
    stub_search(order_body: order.merge("category" => []))
    expect { described_class.new("o1", gateway: gateway).generate }.to raise_error(described_class::NotMicroOrder)
  end

  it "raises NoLabelTarget when the order has no specimen" do
    stub_search([])
    expect { described_class.new("o1", gateway: gateway).generate }.to raise_error(described_class::NoLabelTarget)
  end

  it "renders a PDF with the bundled layout" do
    stub_search([group(occurrence: "2026-11-05T10:00:00+09:00"),
                 item("i8", code: "8", name: "血液培養（好気ボトル）", number: 2)])
    stub_batch

    pdf = described_class.new("o1", gateway: gateway).generate

    expect(pdf).to start_with("%PDF")
    expect(described_class::LAYOUT_PATH).to exist
  end
end
