require "rails_helper"

RSpec.describe "FhirProxy", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }

  describe "GET /fhir/metadata" do
    it "relays status, body and content-type from upstream" do
      stub_request(:get, "#{upstream_base}/metadata")
        .to_return(status: 200, body: '{"resourceType":"CapabilityStatement"}',
                   headers: { "Content-Type" => "application/fhir+json" })

      get "/fhir/metadata"

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to eq("application/fhir+json")
      expect(response.body).to eq('{"resourceType":"CapabilityStatement"}')
    end
  end

  describe "GET /fhir/Patient/:id" do
    it "forwards ETag and Location headers from upstream" do
      stub_request(:get, "#{upstream_base}/Patient/123")
        .to_return(status: 200, body: '{"resourceType":"Patient","id":"123"}',
                   headers: { "Content-Type" => "application/fhir+json", "ETag" => 'W/"2"' })

      get "/fhir/Patient/123"

      expect(response).to have_http_status(:ok)
      expect(response.headers["ETag"]).to eq('W/"2"')
    end
  end

  describe "POST /fhir/Patient" do
    it "forwards the raw request body and Content-Type, and relays Location/ETag on create" do
      body = '{"resourceType":"Patient","identifier":[{"system":"urn:example","value":"P001"}]}'

      stub_request(:post, "#{upstream_base}/Patient")
        .with(body: body, headers: { "Content-Type" => "application/fhir+json" })
        .to_return(status: 201, body: body,
                   headers: {
                     "Content-Type" => "application/fhir+json",
                     "ETag" => 'W/"1"',
                     "Location" => "#{upstream_base}/Patient/123/_history/1"
                   })

      post "/fhir/Patient", params: body, headers: { "Content-Type" => "application/fhir+json" }

      expect(response).to have_http_status(:created)
      expect(response.headers["ETag"]).to eq('W/"1"')
      expect(response.headers["Location"]).to eq("#{upstream_base}/Patient/123/_history/1")
    end
  end

  describe "PUT /fhir/Patient/:id with If-Match" do
    it "forwards the If-Match header and relays a 412 conflict verbatim" do
      outcome = '{"resourceType":"OperationOutcome","issue":[{"severity":"error","code":"conflict"}]}'

      stub_request(:put, "#{upstream_base}/Patient/123")
        .with(headers: { "If-Match" => 'W/"99"' })
        .to_return(status: 412, body: outcome, headers: { "Content-Type" => "application/fhir+json" })

      put "/fhir/Patient/123",
        params: '{"resourceType":"Patient"}',
        headers: { "Content-Type" => "application/fhir+json", "If-Match" => 'W/"99"' }

      expect(response).to have_http_status(:precondition_failed)
      expect(response.body).to eq(outcome)
    end
  end

  describe "search query strings" do
    it "forwards the query string verbatim" do
      stub_request(:get, "#{upstream_base}/Patient")
        .with(query: { "identifier" => "urn:example|P001", "_count" => "5" })
        .to_return(status: 200, body: '{"resourceType":"Bundle"}',
                   headers: { "Content-Type" => "application/fhir+json" })

      get "/fhir/Patient?identifier=urn:example|P001&_count=5"

      expect(response).to have_http_status(:ok)
    end
  end

  describe "POST /fhir (transaction Bundle)" do
    it "relays the bundle to the upstream root and returns the transaction-response" do
      bundle = '{"resourceType":"Bundle","type":"transaction","entry":[]}'
      response_bundle = '{"resourceType":"Bundle","type":"transaction-response","entry":[]}'

      stub_request(:post, "#{upstream_base}/")
        .with(body: bundle, headers: { "Content-Type" => "application/fhir+json" })
        .to_return(status: 200, body: response_bundle,
                   headers: { "Content-Type" => "application/fhir+json" })

      post "/fhir", params: bundle, headers: { "Content-Type" => "application/fhir+json" }

      expect(response).to have_http_status(:ok)
      expect(response.body).to eq(response_bundle)
    end
  end

  describe "GET /fhir/ServiceRequest" do
    it "is allowlisted and forwards the search" do
      stub_request(:get, "#{upstream_base}/ServiceRequest")
        .with(query: { "patient" => "Patient/123" })
        .to_return(status: 200, body: '{"resourceType":"Bundle"}',
                   headers: { "Content-Type" => "application/fhir+json" })

      get "/fhir/ServiceRequest?patient=Patient/123"

      expect(response).to have_http_status(:ok)
    end
  end

  describe "resource type allowlist" do
    it "returns 404 OperationOutcome for a resource type that is not allowlisted, without calling upstream" do
      get "/fhir/Encounter/1"

      expect(response).to have_http_status(:not_found)
      body = JSON.parse(response.body)
      expect(body["resourceType"]).to eq("OperationOutcome")
      expect(body["issue"].first["diagnostics"]).to include("Encounter")
    end

    it "allowlists DiagnosticReport, Observation, Specimen (検査結果機能)、Condition (病名機能)、Questionnaire (テンプレート機能)" do
      %w[DiagnosticReport Observation Specimen Condition Questionnaire].each do |type|
        stub_request(:get, "#{upstream_base}/#{type}")
          .with(query: { "patient" => "Patient/123" })
          .to_return(status: 200, body: '{"resourceType":"Bundle"}',
                     headers: { "Content-Type" => "application/fhir+json" })

        get "/fhir/#{type}?patient=Patient/123"

        expect(response).to have_http_status(:ok)
      end
    end
  end

  describe "upstream unreachable" do
    it "returns 502 with a synthesized OperationOutcome" do
      stub_request(:get, "#{upstream_base}/metadata").to_raise(Faraday::ConnectionFailed.new("connection refused"))

      get "/fhir/metadata"

      expect(response).to have_http_status(:bad_gateway)
      body = JSON.parse(response.body)
      expect(body["resourceType"]).to eq("OperationOutcome")
      expect(body["issue"].first["code"]).to eq("transient")
    end
  end
end
