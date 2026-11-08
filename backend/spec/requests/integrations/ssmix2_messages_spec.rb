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

  def enable(enabled: true, extended_root_path: "")
    FacilitySettings.current.update!(ssmix2: { "enabled" => enabled, "root_path" => "\\\\nas\\ssmix2", "facility_id" => "2219999998",
                                               "extended_root_path" => extended_root_path })
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
      expect(body["storage"]).to eq("root_path" => "\\\\nas\\ssmix2", "extended_root_path" => "", "facility_id" => "2219999998")
      message = body["messages"].sole
      expect(message).to include("storage" => "standard", "patient_id" => "000042", "service_date" => "-", "data_kind" => "ADT-00",
                                 "order_no" => "ALL9", "process" => "INS", "department_code" => "-")
      expect(message).not_to have_key("files")
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

    it "hands a clinical note to the extended storage as a CDA document with its contents file" do
      enable(extended_root_path: "\\\\nas\\ssmix2-ext")
      composition = { "resourceType" => "Composition", "id" => "c1", "meta" => { "versionId" => "1" }, "status" => "final",
                      "type" => { "coding" => [{ "system" => "http://loinc.org", "code" => "11506-3" }] },
                      "subject" => { "reference" => "Patient/p1" }, "date" => "2026-11-05T09:00:00+09:00",
                      "author" => [{ "reference" => "Practitioner/doc1", "display" => "医師 一郎" }], "title" => "診療記録",
                      "section" => [{ "code" => { "coding" => [{ "system" => "http://loinc.org", "code" => "51847-2" }] },
                                      "text" => { "status" => "additional", "div" => '<div xmlns="http://www.w3.org/1999/xhtml"><p>A/P</p></div>' } }] }
      Ssmix2Transaction.create!(occurred_at: Time.current, method: "PUT", path: "/Composition/c1", request: composition, response: composition)
      stub_request(:get, %r{#{upstream_base}/Patient/p1}).to_return(status: 200, body: patient.to_json, headers: { "Content-Type" => "application/fhir+json" })
      stub_request(:get, %r{#{upstream_base}/Practitioner/doc1}).to_return(status: 404, body: "", headers: {})
      stub_request(:get, %r{#{upstream_base}/Organization}).to_return(status: 200, body: { resourceType: "Bundle", entry: [] }.to_json,
                                                                      headers: { "Content-Type" => "application/fhir+json" })

      get "/integrations/ssmix2/messages", headers: auth

      body = JSON.parse(response.body)
      expect(body["storage"]["extended_root_path"]).to eq("\\\\nas\\ssmix2-ext")
      message = body["messages"].sole
      expect(message).to include("storage" => "extended", "patient_id" => "000042", "service_date" => "20261105", "data_kind" => "11506-3",
                                 "process" => "INS", "department_code" => "-", "document_folder" => "^経過記録^^11506-3^経過記録^LN",
                                 "document_name" => "経過記録", "file_name" => "HL7CDA.xml")
      expect(message["order_no"]).to match(/\A\d{15}\z/)
      cda = Base64.strict_decode64(message["body_base64"]).force_encoding("UTF-8")
      expect(cda).to start_with('<?xml version="1.0" encoding="UTF-8"?>')
      expect(Nokogiri::XML(cda, &:strict).root.name).to eq("ClinicalDocument")
      expect(message["files"].map { |f| f["name"] }).to eq(["_contents.xml"])
      expect(Ssmix2Message.sole).to have_attributes(storage: "extended", document_folder: "^経過記録^^11506-3^経過記録^LN")
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

  describe "失敗の再実行と破棄、warning の一覧" do
    def failed_transaction
      Ssmix2Transaction.create!(occurred_at: 1.hour.ago, method: "PUT", path: "/Patient/p1", request: patient, response: patient,
                                status: "failed", attempts: Ssmix2Transaction::MAX_ATTEMPTS, error: "RuntimeError: boom",
                                processed_at: 10.minutes.ago)
    end

    def message(status:, warnings: [], transaction_at: "20261105100000000")
      Ssmix2Message.create!(patient_id: "0000042", service_date: "-", data_kind: "ADT-00", order_no: "ALL9", process: "INS",
                            transaction_at: transaction_at, body: "x".b, status: status, warnings: warnings,
                            attempts: status == "failed" ? Ssmix2Message::MAX_ATTEMPTS : 0,
                            error: status == "failed" ? "disk full" : nil)
    end

    it "lists failed transactions and messages with what was written" do
      transaction = failed_transaction
      failed = message(status: "failed")
      message(status: "written", transaction_at: "20261105100000001")

      get "/integrations/ssmix2/failures"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["transactions"].map { |t| t.slice("id", "resource_types", "error") })
        .to eq([{ "id" => transaction.id, "resource_types" => ["Patient"], "error" => "RuntimeError: boom" }])
      expect(body["messages"].map { |m| m.slice("id", "data_kind", "error", "file_stem") })
        .to eq([{ "id" => failed.id, "data_kind" => "ADT-00", "error" => "disk full",
                  "file_stem" => "0000042_-_ADT-00_ALL9_20261105100000000_-" }])
    end

    it "puts failures back in the queue with a fresh count of attempts" do
      transaction = failed_transaction
      failed = message(status: "failed")
      written = message(status: "written", transaction_at: "20261105100000001")

      post "/integrations/ssmix2/failures/retry",
           params: { transaction_ids: [transaction.id], message_ids: [failed.id, written.id] }, as: :json

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("transactions" => 1, "messages" => 1)
      expect(transaction.reload).to have_attributes(status: "pending", attempts: 0, error: nil, processed_at: nil)
      expect(failed.reload).to have_attributes(status: "pending", attempts: 0, error: nil)
      expect(written.reload.status).to eq("written")
    end

    it "discards failures so that they leave the count and are purged later" do
      enable
      transaction = failed_transaction
      failed = message(status: "failed")

      post "/integrations/ssmix2/failures/discard", params: { transaction_ids: [transaction.id], message_ids: [failed.id] }, as: :json

      expect(transaction.reload.status).to eq("discarded")
      expect(failed.reload.status).to eq("discarded")
      get "/integrations/ssmix2/status"
      expect(JSON.parse(response.body)["failed"]).to eq(0)

      travel_to(Ssmix2Message::RETENTION.from_now + 1.day) do
        Ssmix2Message.purge_written!
        Ssmix2Transaction.purge_processed!
      end
      expect(Ssmix2Message.exists?(failed.id)).to be(false)
      expect(Ssmix2Transaction.exists?(transaction.id)).to be(false)
    end

    it "lists messages with warnings, newest first" do
      older = message(status: "written", warnings: ["HOT コードが引けません: 620000001"], transaction_at: "20261105100000000")
      message(status: "written", transaction_at: "20261105100000001")
      newer = message(status: "pending", warnings: ["診療科コードがありません: 外科"], transaction_at: "20261105100000002")

      get "/integrations/ssmix2/warnings"

      body = JSON.parse(response.body)
      expect(body["messages"].map { |m| [m["id"], m["warnings"]] })
        .to eq([[newer.id, ["診療科コードがありません: 外科"]], [older.id, ["HOT コードが引けません: 620000001"]]])
      expect(body["truncated"]).to be(false)
    end
  end
end
