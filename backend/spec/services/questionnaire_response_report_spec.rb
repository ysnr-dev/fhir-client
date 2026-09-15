require "rails_helper"

# 上流アクセスは「QR 検索 1 本(患者・Questionnaire を _include)+ 画像があれば Binary の
# batch POST 1 本」であること、batch-response のエントリ順対応・Binary の base64 デコード・
# 失敗時の例外マッピングを検証する(PDF 描画自体は ThinreportsRenderer の spec が担う)。
RSpec.describe QuestionnaireResponseReport do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end

  let(:canonical) { "http://example.org/Questionnaire/q1|1.0.0" }
  let(:questionnaire) { { "resourceType" => "Questionnaire", "url" => "http://example.org/Questionnaire/q1", "version" => "1.0.0" } }
  let(:patient) { { "resourceType" => "Patient", "id" => "p1" } }
  let(:image_bytes) { "\x89PNG-bytes".b }

  let(:response_json) do
    {
      "resourceType" => "QuestionnaireResponse",
      "id" => "qr1",
      "questionnaire" => canonical,
      "subject" => { "reference" => "Patient/p1" },
      "item" => [
        {
          "linkId" => "q1",
          "extension" => [
            {
              "url" => QuestionnaireResponseReport::ANNOTATED_IMAGE_EXT_URL,
              "valueAttachment" => { "url" => "Binary/bin1" }
            }
          ]
        }
      ]
    }
  end

  let(:search_path) do
    "#{base_url}/QuestionnaireResponse?_id=qr1" \
      "&_include=QuestionnaireResponse%3Asubject&_include=QuestionnaireResponse%3Aquestionnaire"
  end

  def batch_entry(resource, status: "200 OK")
    { "response" => { "status" => status }, "resource" => resource }
  end

  def batch_response(entries)
    { "resourceType" => "Bundle", "type" => "batch-response", "entry" => entries }
  end

  def searchset(resources)
    { "resourceType" => "Bundle", "type" => "searchset", "entry" => resources.map { |r| { "resource" => r } } }
  end

  def stub_search(resources = [response_json, patient, questionnaire], status: 200)
    stub_request(:get, search_path).to_return(status: status, body: searchset(resources).to_json)
  end

  def stub_batch(entries)
    stub_request(:post, "#{base_url}/")
      .to_return(status: 200, body: batch_response(entries).to_json)
  end

  let(:image_entry) do
    batch_entry({ "resourceType" => "Binary", "contentType" => "image/png",
                  "data" => Base64.strict_encode64(image_bytes) })
  end

  def create_layout!
    ReportLayout.create!(
      name: "layout",
      questionnaire_url: "http://example.org/Questionnaire/q1",
      questionnaire_version: "1.0.0",
      tlf: { items: [] }.to_json,
      mapping: [].to_json
    )
  end

  before { create_layout! }

  it "fetches the response with includes and the images in one batch, then renders" do
    search = stub_search
    batch = stub_batch([image_entry])

    renderer = instance_double(Reports::ThinreportsRenderer, render: "%PDF")
    expect(Reports::ThinreportsRenderer).to receive(:new) do |args|
      expect(args[:questionnaire]).to eq(questionnaire)
      expect(args[:patient]).to eq(patient)
      expect(args[:images]).to eq({ "bin1" => image_bytes })
      renderer
    end

    expect(described_class.new("qr1", gateway: gateway).generate).to eq("%PDF")

    expect(search).to have_been_requested.once
    expect(batch).to have_been_requested.once
    expect(
      a_request(:post, "#{base_url}/").with do |req|
        body = JSON.parse(req.body)
        body["type"] == "batch" && body["entry"].map { |e| e.dig("request", "url") } == ["Binary/bin1"]
      end
    ).to have_been_made.once
  end

  it "skips the batch request when the response has no images" do
    response_without_image = response_json.merge("item" => [{ "linkId" => "q1" }])
    stub_search([response_without_image, patient, questionnaire])
    allow(Reports::ThinreportsRenderer).to receive(:new)
      .and_return(instance_double(Reports::ThinreportsRenderer, render: "%PDF"))

    expect(described_class.new("qr1", gateway: gateway).generate).to eq("%PDF")
    expect(a_request(:post, "#{base_url}/")).not_to have_been_made
  end

  it "picks the questionnaire version named by the canonical" do
    other_version = questionnaire.merge("version" => "2.0.0")
    stub_search([response_json, patient, other_version, questionnaire])
    stub_batch([image_entry])

    expect(Reports::ThinreportsRenderer).to receive(:new) do |args|
      expect(args[:questionnaire]).to eq(questionnaire)
      instance_double(Reports::ThinreportsRenderer, render: "%PDF")
    end

    described_class.new("qr1", gateway: gateway).generate
  end

  it "raises NotFound when the QuestionnaireResponse does not exist" do
    stub_search([])

    expect { described_class.new("qr1", gateway: gateway).generate }
      .to raise_error(described_class::NotFound)
  end

  it "raises QuestionnaireNotFound when the canonical matches nothing" do
    stub_search([response_json, patient])

    expect { described_class.new("qr1", gateway: gateway).generate }
      .to raise_error(described_class::QuestionnaireNotFound)
  end

  it "raises UpstreamError when the patient is not included" do
    stub_search([response_json, questionnaire])

    expect { described_class.new("qr1", gateway: gateway).generate }
      .to raise_error(described_class::UpstreamError, %r{Patient/p1})
  end

  it "raises UpstreamError when a Binary read in the batch fails" do
    stub_search
    stub_batch([{ "response" => { "status" => "404 Not Found" } }])

    expect { described_class.new("qr1", gateway: gateway).generate }
      .to raise_error(described_class::UpstreamError, %r{Binary/bin1})
  end

  it "raises LayoutNotRegistered before any batch request when the layout is missing" do
    ReportLayout.delete_all
    stub_search

    expect { described_class.new("qr1", gateway: gateway).generate }
      .to raise_error(described_class::LayoutNotRegistered)
    expect(a_request(:post, "#{base_url}/")).not_to have_been_made
  end
end
