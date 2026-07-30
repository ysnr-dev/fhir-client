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

  def stub_upstream
    stub_request(:get, "#{upstream_base}/QuestionnaireResponse/qr-1")
      .to_return(status: 200, body: questionnaire_response.to_json,
                 headers: { "Content-Type" => "application/fhir+json" })
    stub_request(:get, "#{upstream_base}/Questionnaire")
      .with(query: { "url" => canonical_url, "version" => "1.0.0" })
      .to_return(status: 200,
                 body: { "resourceType" => "Bundle",
                         "entry" => [{ "resource" => questionnaire }] }.to_json,
                 headers: { "Content-Type" => "application/fhir+json" })
    stub_request(:get, "#{upstream_base}/Patient/pat-1")
      .to_return(status: 200, body: patient.to_json,
                 headers: { "Content-Type" => "application/fhir+json" })
    stub_request(:get, "#{upstream_base}/Binary/bin-1")
      .with(headers: { "Accept" => "image/*" })
      .to_return(status: 200, body: png_1px, headers: { "Content-Type" => "image/png" })
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
      stub_request(:get, "#{upstream_base}/QuestionnaireResponse/qr-1")
        .to_return(status: 404, body: '{"resourceType":"OperationOutcome"}')

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body["error"]).to eq("questionnaire_response_not_found")
    end

    it "returns 422 when the questionnaire cannot be resolved by canonical" do
      create_layout!
      stub_upstream
      stub_request(:get, "#{upstream_base}/Questionnaire")
        .with(query: { "url" => canonical_url, "version" => "1.0.0" })
        .to_return(status: 200, body: { "resourceType" => "Bundle", "entry" => [] }.to_json)

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("questionnaire_not_found")
    end

    it "returns 502 when the upstream is unreachable" do
      create_layout!
      stub_request(:get, "#{upstream_base}/QuestionnaireResponse/qr-1").to_timeout

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:bad_gateway)
      expect(response.parsed_body["error"]).to eq("upstream_unreachable")
    end

    it "returns 502 when the patient cannot be fetched" do
      create_layout!
      stub_upstream
      stub_request(:get, "#{upstream_base}/Patient/pat-1")
        .to_return(status: 404, body: '{"resourceType":"OperationOutcome"}')

      get "/reports/questionnaire_responses/qr-1/pdf"

      expect(response).to have_http_status(:bad_gateway)
      expect(response.parsed_body["error"]).to eq("upstream_unreachable")
    end
  end
end
