require "rails_helper"

# 上流アクセスは「QR read 1本 + batch Bundle POST 1本」の 2 往復であること、
# batch-response のエントリ順対応・Binary の base64 デコード・失敗時の例外
# マッピングを検証する(PDF 描画自体は ThinreportsRenderer の spec が担う)。
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

  def batch_entry(resource, status: "200 OK")
    { "response" => { "status" => status }, "resource" => resource }
  end

  def batch_response(entries)
    { "resourceType" => "Bundle", "type" => "batch-response", "entry" => entries }
  end

  def stub_questionnaire_response(status: 200, body: response_json)
    stub_request(:get, "#{base_url}/QuestionnaireResponse/qr1")
      .to_return(status: status, body: body.to_json)
  end

  def stub_batch(entries)
    stub_request(:post, "#{base_url}/")
      .to_return(status: 200, body: batch_response(entries).to_json)
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

  it "fetches everything in two round trips (QR read + one batch POST) and renders" do
    stub_questionnaire_response
    batch = stub_batch([
      batch_entry({ "resourceType" => "Bundle", "type" => "searchset",
                    "entry" => [{ "resource" => questionnaire }] }),
      batch_entry(patient),
      batch_entry({ "resourceType" => "Binary", "contentType" => "image/png",
                    "data" => Base64.strict_encode64(image_bytes) })
    ])

    renderer = instance_double(Reports::ThinreportsRenderer, render: "%PDF")
    expect(Reports::ThinreportsRenderer).to receive(:new) do |args|
      expect(args[:questionnaire]).to eq(questionnaire)
      expect(args[:patient]).to eq(patient)
      expect(args[:images]).to eq({ "bin1" => image_bytes })
      renderer
    end

    expect(described_class.new("qr1", gateway: gateway).generate).to eq("%PDF")

    expect(batch).to have_been_requested.once
    expect(
      a_request(:post, "#{base_url}/").with do |req|
        entries = JSON.parse(req.body)["entry"]
        urls = entries.map { |e| e.dig("request", "url") }
        urls == [
          "Questionnaire?url=#{CGI.escape('http://example.org/Questionnaire/q1')}&version=1.0.0",
          "Patient/p1",
          "Binary/bin1"
        ] && JSON.parse(req.body)["type"] == "batch"
      end
    ).to have_been_made.once
  end

  it "raises NotFound when the QuestionnaireResponse does not exist" do
    stub_questionnaire_response(status: 404, body: {})

    expect { described_class.new("qr1", gateway: gateway).generate }
      .to raise_error(described_class::NotFound)
  end

  it "raises QuestionnaireNotFound when the canonical matches nothing" do
    stub_questionnaire_response
    stub_batch([
      batch_entry({ "resourceType" => "Bundle", "type" => "searchset", "entry" => [] }),
      batch_entry(patient),
      batch_entry({ "resourceType" => "Binary", "data" => Base64.strict_encode64(image_bytes) })
    ])

    expect { described_class.new("qr1", gateway: gateway).generate }
      .to raise_error(described_class::QuestionnaireNotFound)
  end

  it "raises UpstreamError when a batch entry fails (e.g. the patient read)" do
    stub_questionnaire_response
    stub_batch([
      batch_entry({ "resourceType" => "Bundle", "type" => "searchset",
                    "entry" => [{ "resource" => questionnaire }] }),
      { "response" => { "status" => "404 Not Found" } },
      batch_entry({ "resourceType" => "Binary", "data" => Base64.strict_encode64(image_bytes) })
    ])

    expect { described_class.new("qr1", gateway: gateway).generate }
      .to raise_error(described_class::UpstreamError, /Patient\/p1/)
  end

  it "raises LayoutNotRegistered before any batch request when the layout is missing" do
    ReportLayout.delete_all
    stub_questionnaire_response

    expect { described_class.new("qr1", gateway: gateway).generate }
      .to raise_error(described_class::LayoutNotRegistered)
    expect(a_request(:post, "#{base_url}/")).not_to have_been_made
  end
end
