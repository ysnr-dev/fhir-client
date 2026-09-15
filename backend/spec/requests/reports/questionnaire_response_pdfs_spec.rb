require "rails_helper"

RSpec.describe "Reports::QuestionnaireResponsePdfs", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }
  let(:canonical_url) { "http://example.com/Questionnaire/intake" }

  let(:questionnaire) do
    {
      "resourceType" => "Questionnaire",
      "id" => "q-1",
      "url" => canonical_url,
      "version" => "1.0.0",
      "title" => "初診時問診票",
      "item" => [
        { "linkId" => "chief-complaint", "type" => "string", "text" => "主訴" },
        { "linkId" => "schema-body", "type" => "display", "text" => "シェーマ" }
      ]
    }
  end

  let(:questionnaire_response) do
    {
      "resourceType" => "QuestionnaireResponse",
      "id" => "qr-1",
      "questionnaire" => "#{canonical_url}|1.0.0",
      "status" => "completed",
      "subject" => { "reference" => "Patient/pat-1" },
      "authored" => "2026-07-30T01:23:00Z",
      "item" => [
        { "linkId" => "chief-complaint", "text" => "主訴",
          "answer" => [{ "valueString" => "頭痛" }] },
        { "linkId" => "schema-body", "text" => "シェーマ",
          "extension" => [
            { "url" => "http://fhir-client.local/StructureDefinition/questionnaire-response-annotated-image",
              "valueAttachment" => { "contentType" => "image/png", "url" => "Binary/bin-1" } }
          ] }
      ]
    }
  end

  let(:patient) do
    {
      "resourceType" => "Patient",
      "id" => "pat-1",
      "identifier" => [{ "value" => "P001" }],
      "name" => [{ "family" => "テスト", "given" => ["太郎"] }],
      "gender" => "male",
      "birthDate" => "1980-07-31"
    }
  end

  let(:png_1px) do
    Base64.decode64(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
  end

  def create_layout!
    ReportLayout.create!(
      name: "テスト帳票",
      questionnaire_url: canonical_url,
      questionnaire_version: "1.0.0",
      tlf: Rails.root.join("spec/fixtures/files/questionnaire_response_layout.tlf").read
    )
  end

  # QR は患者・元 Questionnaire を _include した検索で、シェーマ画像は Binary の batch で取得される。
  def search_url
    "#{upstream_base}/QuestionnaireResponse?_id=qr-1" \
      "&_include=QuestionnaireResponse%3Asubject&_include=QuestionnaireResponse%3Aquestionnaire"
  end

  def stub_search(resources: [questionnaire_response, patient, questionnaire], status: 200)
    stub_request(:get, search_url)
      .to_return(status: status,
                 body: { "resourceType" => "Bundle", "type" => "searchset",
                         "entry" => resources.map { |r| { "resource" => r } } }.to_json,
                 headers: { "Content-Type" => "application/fhir+json" })
  end

  def stub_binary_batch(entries = [binary_entry])
    stub_request(:post, "#{upstream_base}/")
      .to_return(status: 200,
                 body: { "resourceType" => "Bundle", "type" => "batch-response",
                         "entry" => entries }.to_json,
                 headers: { "Content-Type" => "application/fhir+json" })
  end

  def binary_entry
    { "response" => { "status" => "200 OK" },
      "resource" => { "resourceType" => "Binary", "contentType" => "image/png",
                      "data" => Base64.strict_encode64(png_1px) } }
  end

  def stub_upstream
    stub_search
    stub_binary_batch
  end

  describe "GET /reports/questionnaire_responses/:id/pdf" do
    it "renders the response into the registered layout as an inline PDF" do
      create_layout!
      stub_upstream

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to eq("application/pdf")
      expect(response.headers["Content-Disposition"]).to include("inline")
      expect(response.body[0, 5]).to eq("%PDF-")
      expect(PDF::Inspector::Text.analyze(response.body).strings).to include("頭痛")
    end

    it "returns 404 when no layout is registered for the canonical" do
      stub_upstream

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body["error"]).to eq("layout_not_registered")
    end

    it "returns 404 when the QuestionnaireResponse does not exist upstream" do
      create_layout!
      stub_search(resources: [])

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body["error"]).to eq("questionnaire_response_not_found")
    end

    it "returns 422 when the questionnaire cannot be resolved by canonical" do
      create_layout!
      stub_search(resources: [questionnaire_response, patient])

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("questionnaire_not_found")
    end

    it "returns 502 when the upstream is unreachable" do
      create_layout!
      stub_request(:get, search_url).to_timeout

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:bad_gateway)
      expect(response.parsed_body["error"]).to eq("upstream_unreachable")
    end

    it "returns 502 when the patient cannot be fetched" do
      create_layout!
      stub_search(resources: [questionnaire_response, questionnaire])

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:bad_gateway)
      expect(response.parsed_body["error"]).to eq("upstream_unreachable")
    end
  end
end
