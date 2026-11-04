require "rails_helper"

# エージェント向けの受け渡し(docs/ssmix2-export-design.md §6)。
RSpec.describe "SS-MIX2 のエージェント向け API", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }
  let(:token) { ExternalSystemConnection.current("ssmix2_storage").regenerate_inbound_token! }
  let(:auth) { { "Authorization" => "Bearer #{token}" } }
  let(:patient) do
    { "resourceType" => "Patient", "id" => "p1",
      "identifier" => [{ "system" => Ssmix2::Fhir::PATIENT_IDENTIFIER_SYSTEM, "value" => "42" }],
      "name" => [{ "family" => "患者", "given" => ["太郎"] }], "gender" => "female", "birthDate" => "1990-01-02" }
  end

  def enable(enabled: true)
    FacilitySettings.current.update!(ssmix2: { "enabled" => enabled, "root_path" => "\\\\nas\\ssmix2", "facility_id" => "2219999998" })
    Ssmix2::Settings.reset_cache!
  end

  def record_patient_put
    Ssmix2Transaction.create!(occurred_at: Time.current, method: "PUT", path: "/Patient/p1", request: patient, response: patient)
  end

  before do
    Ssmix2::Settings.reset_cache!
    Ssmix2::ResourceCache.shared.clear
    stub_request(:get, %r{#{upstream_base}/Encounter}).to_return(status: 200, body: { resourceType: "Bundle", entry: [] }.to_json,
                                                                 headers: { "Content-Type" => "application/fhir+json" })
  end

  describe "GET /integrations/ssmix2/messages" do
    it "rejects a missing token and a wrong token" do
      get "/integrations/ssmix2/messages"
      expect(response).to have_http_status(:not_found)

      token
      get "/integrations/ssmix2/messages", headers: { "Authorization" => "Bearer wrong" }
      expect(response).to have_http_status(:unauthorized)
    end

    it "answers enabled: false without touching the queue when the facility setting is off" do
      enable(enabled: false)
      record_patient_put

      get "/integrations/ssmix2/messages", headers: auth

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("enabled" => false, "messages" => [])
      expect(Ssmix2Transaction.sole.status).to eq("pending")
    end

    it "materializes pending transactions into messages, leases them and returns the storage settings" do
      enable
      record_patient_put

      get "/integrations/ssmix2/messages", headers: auth

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["enabled"]).to be(true)
      expect(body["storage"]).to eq("root_path" => "\\\\nas\\ssmix2", "facility_id" => "2219999998")
      message = body["messages"].sole
      expect(message).to include("patient_id" => "000042", "service_date" => "-", "data_kind" => "ADT-00",
                                 "order_no" => "ALL9", "process" => "INS", "department_code" => "-")
      expect(message["transaction_at"]).to match(/\A\d{17}\z/)
      hl7 = Base64.strict_decode64(message["body_base64"]).encode("UTF-8", "CP50221")
      expect(hl7).to start_with("MSH|^~\\&|fhir-client|2219999998|GW|")
      expect(hl7).to include("\rPID|0001||000042^^^^PI||患者^太郎^^^^^L^I||19900102|F")
      expect(Ssmix2Transaction.sole.status).to eq("done")
      expect(Ssmix2Message.sole.status).to eq("leased")

      # 取ったままの分は配り直さない。
      get "/integrations/ssmix2/messages", headers: auth
      expect(JSON.parse(response.body)["messages"]).to be_empty
    end

    it "keeps a transaction pending when the upstream is rate limited, and fails it after repeated errors" do
      enable
      row = record_patient_put
      stub_request(:get, %r{#{upstream_base}/Encounter}).to_return(status: 429, body: "", headers: {})

      get "/integrations/ssmix2/messages", headers: auth
      expect(row.reload.status).to eq("pending")
      expect(row.attempts).to eq(0)

      stub_request(:get, %r{#{upstream_base}/Encounter}).to_return(status: 500, body: "boom", headers: {})
      Ssmix2Transaction::MAX_ATTEMPTS.times { get "/integrations/ssmix2/messages", headers: auth }
      expect(row.reload.status).to eq("failed")
      expect(row.error).to include("HTTP 500")
    end
  end

  describe "POST /integrations/ssmix2/messages/ack" do
    it "marks written messages and returns failed ones to pending until they give up" do
      enable
      record_patient_put
      get "/integrations/ssmix2/messages", headers: auth
      id = JSON.parse(response.body)["messages"].sole["id"]

      post "/integrations/ssmix2/messages/ack", params: { failed: [{ id: id, error: "disk full" }] }, headers: auth, as: :json
      expect(response).to have_http_status(:no_content)
      expect(Ssmix2Message.find(id)).to have_attributes(status: "pending", attempts: 1, error: "disk full")

      post "/integrations/ssmix2/messages/ack", params: { written: [id] }, headers: auth, as: :json
      expect(Ssmix2Message.find(id).status).to eq("written")
      expect(Ssmix2Message.find(id).written_at).to be_present
    end
  end

  describe "GET /integrations/ssmix2/status" do
    it "counts the queue for the settings screen" do
      enable
      record_patient_put

      get "/integrations/ssmix2/status"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to include("enabled" => true, "pending" => 1, "failed" => 0, "written_today" => 0)
      expect(body["recent_failures"]).to eq([])
    end
  end
end
