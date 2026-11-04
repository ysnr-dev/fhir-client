require "rails_helper"

# 中継の書き込みが SS-MIX2 出力の控え(ssmix2_transactions)に残ること(docs/ssmix2-export-design.md §4)。
RSpec.describe "SS-MIX2 transaction の記録", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }
  let(:fhir_headers) { { "Content-Type" => "application/fhir+json" } }
  let(:patient) { '{"resourceType":"Patient","id":"123","identifier":[{"value":"0001"}]}' }

  def enable_ssmix2(enabled: true)
    FacilitySettings.current.update!(ssmix2: { "enabled" => enabled, "root_path" => "/ssmix2", "facility_id" => "2219999998" })
    Ssmix2::Settings.reset_cache!
  end

  before { Ssmix2::Settings.reset_cache! }

  it "records a transaction Bundle that writes a target resource, with the transaction-response" do
    enable_ssmix2
    bundle = { resourceType: "Bundle", type: "transaction",
               entry: [{ fullUrl: "urn:uuid:a", resource: JSON.parse(patient).except("id"),
                         request: { method: "POST", url: "Patient" } }] }.to_json
    response_bundle = { resourceType: "Bundle", type: "transaction-response",
                        entry: [{ response: { status: "201 Created", location: "Patient/123/_history/1" } }] }.to_json
    stub_request(:post, "#{upstream_base}/").to_return(status: 200, body: response_bundle, headers: fhir_headers)

    post "/fhir", params: bundle, headers: fhir_headers

    expect(response).to have_http_status(:ok)
    row = Ssmix2Transaction.sole
    expect(row.method).to eq("POST")
    expect(row.path).to eq("/")
    expect(row.status).to eq("pending")
    expect(row.request["type"]).to eq("transaction")
    expect(row.response.dig("entry", 0, "response", "location")).to eq("Patient/123/_history/1")
  end

  it "records a single PUT and a DELETE of a target resource" do
    enable_ssmix2
    stub_request(:put, "#{upstream_base}/Patient/123").to_return(status: 200, body: patient, headers: fhir_headers)
    stub_request(:delete, "#{upstream_base}/Condition/9").to_return(status: 204, body: "")

    put "/fhir/Patient/123", params: patient, headers: fhir_headers
    delete "/fhir/Condition/9"

    expect(Ssmix2Transaction.order(:id).pluck(:method, :path)).to eq([%w[PUT /Patient/123], %w[DELETE /Condition/9]])
    expect(Ssmix2Transaction.find_by(method: "DELETE").response).to be_nil
  end

  it "does not record when disabled, on reads, on upstream failure, or for resources outside the target" do
    enable_ssmix2(enabled: false)
    stub_request(:put, "#{upstream_base}/Patient/123").to_return(status: 200, body: patient, headers: fhir_headers)
    put "/fhir/Patient/123", params: patient, headers: fhir_headers
    expect(Ssmix2Transaction.count).to eq(0)

    enable_ssmix2
    stub_request(:get, "#{upstream_base}/Patient/123").to_return(status: 200, body: patient, headers: fhir_headers)
    get "/fhir/Patient/123"

    stub_request(:put, "#{upstream_base}/Patient/9").to_return(status: 412, body: "{}", headers: fhir_headers)
    put "/fhir/Patient/9", params: patient, headers: fhir_headers

    observation = '{"resourceType":"Observation","status":"final"}'
    stub_request(:post, "#{upstream_base}/Observation").to_return(status: 201, body: observation, headers: fhir_headers)
    post "/fhir/Observation", params: observation, headers: fhir_headers

    batch = { resourceType: "Bundle", type: "batch", entry: [{ request: { method: "GET", url: "Patient/1" } }] }.to_json
    stub_request(:post, "#{upstream_base}/").to_return(status: 200, body: batch, headers: fhir_headers)
    post "/fhir", params: batch, headers: fhir_headers

    expect(Ssmix2Transaction.count).to eq(0)
  end

  it "keeps relaying when the recording fails" do
    enable_ssmix2
    allow(Ssmix2Transaction).to receive(:create!).and_raise(ActiveRecord::StatementInvalid, "boom")
    stub_request(:put, "#{upstream_base}/Patient/123").to_return(status: 200, body: patient, headers: fhir_headers)

    put "/fhir/Patient/123", params: patient, headers: fhir_headers

    expect(response).to have_http_status(:ok)
    expect(response.body).to eq(patient)
  end

  it "records writes made by the backend itself through FhirStore without an actor" do
    enable_ssmix2
    stub_request(:put, "#{upstream_base}/Patient").with(query: { "identifier" => "urn:x|0001" })
      .to_return(status: 201, body: patient, headers: fhir_headers)

    Integrations::FhirStore.new.conditional_put("Patient", JSON.parse(patient), identifier: "urn:x|0001")

    row = Ssmix2Transaction.sole
    expect(row.method).to eq("PUT")
    expect(row.actor_practitioner_id).to be_nil
    expect(row.request["resourceType"]).to eq("Patient")
  end
end
