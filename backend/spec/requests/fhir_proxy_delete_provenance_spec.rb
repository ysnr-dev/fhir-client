require "rails_helper"

RSpec.describe "FhirProxy の削除の来歴", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }
  let(:fhir_json) { { "Content-Type" => "application/fhir+json" } }
  let(:admin_token) { "s3cret-admin-passphrase" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def login_as_practitioner
    User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
    post "/auth/session", params: { login_id: "tanaka", password: "password123" }, as: :json
    response.parsed_body["csrf_token"]
  end

  def provenance_of(body)
    entry = JSON.parse(body)["entry"].find { |e| e.dig("resource", "resourceType") == "Provenance" }
    entry && entry["resource"]
  end

  def transaction(*entries)
    { resourceType: "Bundle", type: "transaction", entry: entries }.to_json
  end

  describe "POST /fhir (transaction)" do
    it "診療記録の削除に、ログイン本人と理由を持つ削除の来歴を添える" do
      stub_request(:get, "#{upstream_base}/Practitioner/prac-1")
        .to_return(status: 200, headers: fhir_json, body: {
          resourceType: "Practitioner", id: "prac-1",
          name: [
            { family: "タナカ", given: ["イチロウ"],
              extension: [{ url: "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation", valueCode: "SYL" }] },
            { family: "田中", given: ["一郎"],
              extension: [{ url: "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation", valueCode: "IDE" }] }
          ]
        }.to_json)
      forwarded = nil
      stub_request(:post, "#{upstream_base}/").to_return do |request|
        forwarded = request.body
        { status: 200, headers: fhir_json, body: '{"resourceType":"Bundle","type":"transaction-response"}' }
      end

      with_admin_token do
        csrf = login_as_practitioner
        post "/fhir",
             params: transaction(
               { request: { method: "DELETE", url: "Composition/c1" } },
               { request: { method: "DELETE", url: "QuestionnaireResponse/q1" } },
               { request: { method: "DELETE", url: "Task/t1" } }
             ),
             headers: fhir_json.merge("X-CSRF-Token" => csrf, "X-Delete-Reason" => ERB::Util.url_encode("患者 違い"))
      end

      expect(response).to have_http_status(:ok)
      provenance = provenance_of(forwarded)
      expect(provenance["target"]).to eq([{ "reference" => "Composition/c1" }, { "reference" => "QuestionnaireResponse/q1" }])
      expect(provenance.dig("activity", "coding", 0, "code")).to eq("DELETE")
      expect(provenance["reason"]).to eq([{ "text" => "患者 違い" }])
      expect(provenance.dig("agent", 0, "who")).to eq("reference" => "Practitioner/prac-1", "display" => "田中 一郎")
      expect(provenance["recorded"]).to end_with("+09:00")
    end

    it "対象の型の削除が無ければ本文をそのまま送る" do
      body = transaction(
        { request: { method: "DELETE", url: "Task/t1" } },
        { request: { method: "DELETE", url: "MedicationRequest?based-on=ServiceRequest/s1" } }
      )
      stub_request(:post, "#{upstream_base}/").with(body: body)
                                              .to_return(status: 200, headers: fhir_json, body: "{}")

      post "/fhir", params: body, headers: fhir_json

      expect(response).to have_http_status(:ok)
    end

    it "ログインが無ければログイン名の代わりに不明と記録する" do
      forwarded = nil
      stub_request(:post, "#{upstream_base}/").to_return do |request|
        forwarded = request.body
        { status: 200, headers: fhir_json, body: "{}" }
      end

      post "/fhir", params: transaction({ request: { method: "DELETE", url: "ServiceRequest/s1" } }), headers: fhir_json

      provenance = provenance_of(forwarded)
      expect(provenance.dig("agent", 0, "who")).to eq("display" => "不明")
      expect(provenance).not_to have_key("reason")
    end
  end

  describe "DELETE /fhir/:type/:id" do
    it "診療記録の単体削除は来歴付きの transaction で送り、204 を返す" do
      forwarded = nil
      stub_request(:post, "#{upstream_base}/").to_return do |request|
        forwarded = JSON.parse(request.body)
        { status: 200, headers: fhir_json, body: '{"resourceType":"Bundle","type":"transaction-response"}' }
      end

      delete "/fhir/Observation/o1", headers: { "If-Match" => 'W/"3"', "X-Delete-Reason" => ERB::Util.url_encode("誤入力") }

      expect(response).to have_http_status(:no_content)
      expect(forwarded["entry"][0]["request"]).to eq("method" => "DELETE", "url" => "Observation/o1", "ifMatch" => 'W/"3"')
      provenance = forwarded["entry"][1]["resource"]
      expect(provenance["target"]).to eq([{ "reference" => "Observation/o1" }])
      expect(provenance["reason"]).to eq([{ "text" => "誤入力" }])
    end

    it "上流の失敗はそのまま返す" do
      outcome = '{"resourceType":"OperationOutcome","issue":[{"severity":"error","code":"not-found"}]}'
      stub_request(:post, "#{upstream_base}/").to_return(status: 404, headers: fhir_json, body: outcome)

      delete "/fhir/Observation/missing"

      expect(response).to have_http_status(:not_found)
      expect(response.body).to eq(outcome)
    end

    it "対象外の型はそのまま DELETE で送る" do
      stub_request(:delete, "#{upstream_base}/Task/t1").to_return(status: 204)

      delete "/fhir/Task/t1"

      expect(response).to have_http_status(:no_content)
    end
  end
end
