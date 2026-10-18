require "rails_helper"

RSpec.describe "CDS Hooks (patient-view / feedback)", type: :request do
  let(:admin_token) { "s3cret-admin-passphrase" }
  let(:fhir_base) { "http://fhir.example" }
  let(:cds_base) { "https://cds.example" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def login_as_practitioner
    User.find_or_create_by!(login_id: "tanaka") { |u| u.password = "password123"; u.practitioner_fhir_id = "prac-1" }
    post "/auth/session", params: { login_id: "tanaka", password: "password123" }, as: :json
    response.parsed_body["csrf_token"]
  end

  def login_as_administrator
    post "/auth/session", params: { login_id: "administrator", password: admin_token }, as: :json
    response.parsed_body["csrf_token"]
  end

  let!(:provider) { CdsService.create!(name: "薬剤安全", base_url: cds_base) }
  let!(:smart_app) do
    SmartApp.create!(name: "用量確認", client_id: "c1", launch_url: "https://app.example/launch?mode=karte")
  end

  before do
    FhirConnectionSettings.current.update!(base_url: fhir_base, public_base_url: "http://localhost:3000")
    Integrations::Cds::Discovery.reset!
    stub_request(:get, "#{cds_base}/cds-services").to_return(status: 200, body: {
      services: [
        { id: "pv", hook: "patient-view",
          prefetch: { patient: "Patient/{{context.patientId}}",
                      meds: "MedicationRequest?patient={{context.patientId}}&status=active",
                      enc: "Encounter/{{context.encounterId}}",
                      audit: "AuditEvent?patient={{context.patientId}}" } },
        { id: "os", hook: "order-sign", prefetch: { patient: "Patient/{{context.patientId}}" } },
        { id: "osel", hook: "order-select" }
      ]
    }.to_json)
    stub_request(:get, "#{fhir_base}/Patient/p-1").to_return(status: 200, body: { resourceType: "Patient", id: "p-1" }.to_json)
    stub_request(:get, "#{fhir_base}/MedicationRequest?patient=p-1&status=active&_count=100")
      .to_return(status: 200, body: { resourceType: "Bundle", total: 2 }.to_json)
  end

  def post_patient_view(csrf, params = { patient_id: "p-1" })
    post "/integrations/cds/patient_view", params: params, headers: { "X-CSRF-Token" => csrf }, as: :json
  end

  describe "POST /integrations/cds/patient_view" do
    it "calls patient-view services with resolved prefetch and returns normalized cards" do
      hook = stub_request(:post, "#{cds_base}/cds-services/pv").to_return(status: 200, body: {
        cards: [
          { uuid: "card-1", summary: "腎機能に応じた用量の確認", indicator: "warning",
            source: { label: "薬剤安全", topic: { display: "薬剤" } },
            links: [
              { label: "アプリで開く", url: "https://app.example/launch", type: "smart", appContext: "{\"card\":\"x\"}" },
              { label: "未登録", url: "https://other.example/app", type: "smart" },
              { label: "仕様", url: "https://cds-hooks.hl7.org/", type: "absolute" },
              { label: "怪しい", url: "javascript:alert(1)", type: "absolute" }
            ],
            overrideReasons: [{ code: "reviewed", system: "http://x", display: "確認済み" }],
            suggestions: [{ label: "記録する", actions: [{ type: "create", description: "作る" }] }] },
          { summary: "x" * 200, indicator: "bogus" },
          { detail: "summary が無い" }
        ]
      }.to_json)

      with_admin_token do
        csrf = login_as_practitioner
        post_patient_view(csrf, { patient_id: "p-1" })
      end

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["services"]).to eq([{ "id" => provider.id, "name" => "薬剤安全", "status" => "ok", "services" => 1 }])
      expect(body["cards"].size).to eq(2)

      card = body["cards"].first
      expect(card).to include("uuid" => "card-1", "indicator" => "warning")
      expect(card["source"]).to eq("label" => "薬剤安全", "topic" => "薬剤")
      expect(card["links"]).to eq([
        { "label" => "アプリで開く", "type" => "smart", "url" => "https://app.example/launch",
          "smart_app_id" => smart_app.id, "app_context" => "{\"card\":\"x\"}" },
        { "label" => "未登録", "type" => "smart", "url" => "https://other.example/app", "smart_app_id" => nil,
          "app_context" => nil },
        { "label" => "仕様", "type" => "absolute", "url" => "https://cds-hooks.hl7.org/" }
      ])
      expect(card["override_reasons"]).to eq([{ "code" => "reviewed", "system" => "http://x", "display" => "確認済み" }])
      expect(card["suggestions"]).to eq([{ "label" => "記録する", "actions" => ["作る"] }])
      expect(card["service"]).to eq("id" => provider.id, "name" => "薬剤安全", "service" => "pv")

      second = body["cards"].last
      expect(second["summary"].length).to eq(140)
      expect(second["indicator"]).to eq("info")
      expect(second["uuid"]).to be_present

      expect(hook).to have_been_requested.once
    end

    it "sends the hook request with context and only the prefetch it could satisfy" do
      captured = nil
      stub_request(:post, "#{cds_base}/cds-services/pv").with { |req| captured = JSON.parse(req.body) }
                                                        .to_return(status: 200, body: { cards: [] }.to_json)

      with_admin_token do
        csrf = login_as_practitioner
        post_patient_view(csrf, { patient_id: "p-1" })
      end

      expect(captured["hook"]).to eq("patient-view")
      expect(captured["fhirServer"]).to eq("http://localhost:3000")
      expect(captured["hookInstance"]).to be_present
      expect(captured["context"]).to eq("userId" => "Practitioner/prac-1", "patientId" => "p-1")
      # encounter が無いテンプレートと、許可外の型(AuditEvent)は省く。
      expect(captured["prefetch"].keys).to contain_exactly("patient", "meds")
      expect(captured["prefetch"]["patient"]).to include("resourceType" => "Patient")
      expect(captured).not_to have_key("fhirAuthorization")
      expect(a_request(:get, /AuditEvent/)).not_to have_been_made
    end

    it "hands a delegated token as fhirAuthorization when the provider has a client" do
      provider.update!(client_id: "c0ffee-0001")
      FhirConnectionSettings.current.update!(fhir_admin_token: "upstream-admin")
      stub_request(:get, "#{fhir_base}/up").to_return(status: 200, body: "ok")
      issued = stub_request(:post, "#{fhir_base}/admin/delegated_tokens")
               .with(body: { client_id: "c0ffee-0001", practitioner_id: "prac-1", patient_id: "p-1" }.to_json,
                     headers: { "X-FHIR-Admin-Token" => "upstream-admin" })
               .to_return(status: 201, body: {
                 access_token: "tok-1", token_type: "Bearer", expires_in: 300, scope: "user/*.read",
                 subject: "c0ffee-0001", patient: "p-1"
               }.to_json)
      captured = nil
      stub_request(:post, "#{cds_base}/cds-services/pv").with { |req| captured = JSON.parse(req.body) }
                                                        .to_return(status: 200, body: { cards: [] }.to_json)

      with_admin_token do
        csrf = login_as_practitioner
        post_patient_view(csrf)
      end

      expect(issued).to have_been_requested.once
      expect(captured["fhirAuthorization"]).to eq(
        "access_token" => "tok-1", "token_type" => "Bearer", "expires_in" => 300, "scope" => "user/*.read",
        "subject" => "c0ffee-0001", "patient" => "p-1"
      )
    end

    it "still calls the service without fhirAuthorization when the token cannot be issued" do
      provider.update!(client_id: "c0ffee-0001")
      FhirConnectionSettings.current.update!(fhir_admin_token: "upstream-admin")
      stub_request(:post, "#{fhir_base}/admin/delegated_tokens").to_return(status: 422, body: { errors: ["x"] }.to_json)
      captured = nil
      stub_request(:post, "#{cds_base}/cds-services/pv").with { |req| captured = JSON.parse(req.body) }
                                                        .to_return(status: 200, body: { cards: [] }.to_json)

      with_admin_token do
        csrf = login_as_practitioner
        post_patient_view(csrf)
      end

      expect(response).to have_http_status(:ok)
      expect(captured).not_to have_key("fhirAuthorization")
    end

    it "includes the encounter when given" do
      captured = nil
      stub_request(:get, "#{fhir_base}/Encounter/e-1").to_return(status: 200, body: { resourceType: "Encounter", id: "e-1" }.to_json)
      stub_request(:post, "#{cds_base}/cds-services/pv").with { |req| captured = JSON.parse(req.body) }
                                                        .to_return(status: 200, body: { cards: [] }.to_json)

      with_admin_token do
        csrf = login_as_practitioner
        post_patient_view(csrf, { patient_id: "p-1", encounter_id: "e-1" })
      end

      expect(captured["context"]["encounterId"]).to eq("e-1")
      expect(captured["prefetch"].keys).to contain_exactly("patient", "meds", "enc")
    end

    it "returns no cards but a failed status when the provider is down" do
      stub_request(:post, "#{cds_base}/cds-services/pv").to_timeout

      with_admin_token do
        csrf = login_as_practitioner
        post_patient_view(csrf)
      end

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["cards"]).to eq([])
      expect(response.parsed_body["services"].first).to include("status" => "failed")
    end

    it "skips the call for logins without a practitioner" do
      with_admin_token do
        csrf = login_as_administrator
        post_patient_view(csrf)
      end

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("cards" => [], "services" => [], "skipped" => "practitioner_required")
      expect(a_request(:get, "#{cds_base}/cds-services")).not_to have_been_made
    end

    it "requires a patient" do
      with_admin_token do
        csrf = login_as_practitioner
        post_patient_view(csrf, {})
      end

      expect(response).to have_http_status(:bad_request)
    end
  end

  describe "order hooks" do
    def draft_orders(patient_id = "p-1")
      {
        resourceType: "Bundle", type: "collection",
        entry: [
          { resource: { resourceType: "MedicationRequest", id: "draft-1-1", status: "draft", intent: "order",
                        subject: { reference: "Patient/#{patient_id}" },
                        medicationCodeableConcept: { text: "メトホルミン塩酸塩錠250mg" } } },
          { resource: { resourceType: "MedicationRequest", id: "draft-1-2", status: "draft", intent: "order",
                        subject: { reference: "Patient/#{patient_id}" } } }
        ]
      }
    end

    it "calls order-sign services with draftOrders in the context" do
      captured = nil
      stub_request(:post, "#{cds_base}/cds-services/os").with { |req| captured = JSON.parse(req.body) }
                                                        .to_return(status: 200, body: { cards: [{ summary: "腎機能", indicator: "critical" }] }.to_json)

      with_admin_token do
        csrf = login_as_practitioner
        post "/integrations/cds/order_sign", params: { patient_id: "p-1", draft_orders: draft_orders },
                                             headers: { "X-CSRF-Token" => csrf }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["cards"].first).to include("summary" => "腎機能", "indicator" => "critical")
      expect(response.parsed_body["cards"].first["service"]).to include("service" => "os")
      expect(captured["hook"]).to eq("order-sign")
      expect(captured["context"]["draftOrders"]["entry"].map { |e| e["resource"]["id"] }).to eq(%w[draft-1-1 draft-1-2])
      expect(captured["context"]).not_to have_key("selections")
      expect(captured["prefetch"].keys).to eq(["patient"])
      expect(a_request(:post, "#{cds_base}/cds-services/pv")).not_to have_been_made
    end

    it "calls order-select services with the selections" do
      captured = nil
      stub_request(:post, "#{cds_base}/cds-services/osel").with { |req| captured = JSON.parse(req.body) }
                                                          .to_return(status: 200, body: { cards: [] }.to_json)

      with_admin_token do
        csrf = login_as_practitioner
        post "/integrations/cds/order_select",
             params: { patient_id: "p-1", draft_orders: draft_orders, selections: ["MedicationRequest/draft-1-2"] },
             headers: { "X-CSRF-Token" => csrf }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(captured["hook"]).to eq("order-select")
      expect(captured["context"]["selections"]).to eq(["MedicationRequest/draft-1-2"])
      expect(captured["context"]["draftOrders"]["entry"].size).to eq(2)
    end

    it "rejects draft orders that are malformed, of another patient or not selected" do
      with_admin_token do
        csrf = login_as_practitioner
        headers = { "X-CSRF-Token" => csrf }

        post "/integrations/cds/order_sign", params: { patient_id: "p-1", draft_orders: { resourceType: "Patient" } },
                                             headers: headers, as: :json
        expect(response).to have_http_status(:bad_request)

        post "/integrations/cds/order_sign", params: { patient_id: "p-1", draft_orders: draft_orders("p-2") },
                                             headers: headers, as: :json
        expect(response).to have_http_status(:bad_request)
        expect(response.parsed_body["error"]).to include("patient")

        post "/integrations/cds/order_select",
             params: { patient_id: "p-1", draft_orders: draft_orders, selections: ["MedicationRequest/other"] },
             headers: headers, as: :json
        expect(response).to have_http_status(:bad_request)
      end
    end
  end

  describe "POST /integrations/cds/feedback" do
    it "forwards an override with its reason and answers 204 even if the service fails" do
      captured = nil
      stub_request(:post, "#{cds_base}/cds-services/pv/feedback").with { |req| captured = JSON.parse(req.body) }
                                                                 .to_return(status: 200, body: "{}")

      with_admin_token do
        csrf = login_as_practitioner
        post "/integrations/cds/feedback",
             params: { service_id: provider.id, service: "pv", card: "card-1", outcome: "overridden",
                       override_reason: { code: "reviewed", system: "http://x" }, user_comment: "済み" },
             headers: { "X-CSRF-Token" => csrf }, as: :json
      end

      expect(response).to have_http_status(:no_content)
      entry = captured["feedback"].first
      expect(entry).to include("card" => "card-1", "outcome" => "overridden")
      expect(entry["overrideReason"]).to eq("reason" => { "code" => "reviewed", "system" => "http://x" }, "userComment" => "済み")
      expect(entry["outcomeTimestamp"]).to be_present

      stub_request(:post, "#{cds_base}/cds-services/pv/feedback").to_return(status: 500, body: "")
      with_admin_token do
        csrf = login_as_practitioner
        post "/integrations/cds/feedback",
             params: { service_id: provider.id, service: "pv", card: "card-1", outcome: "overridden" },
             headers: { "X-CSRF-Token" => csrf }, as: :json
      end
      expect(response).to have_http_status(:no_content)
    end

    it "rejects unknown providers and outcomes" do
      with_admin_token do
        csrf = login_as_practitioner
        post "/integrations/cds/feedback", params: { service_id: 999, service: "pv", card: "c", outcome: "overridden" },
                                           headers: { "X-CSRF-Token" => csrf }, as: :json
        expect(response).to have_http_status(:not_found)

        post "/integrations/cds/feedback", params: { service_id: provider.id, service: "pv", card: "c", outcome: "accepted" },
                                           headers: { "X-CSRF-Token" => csrf }, as: :json
        expect(response).to have_http_status(:bad_request)
      end
    end
  end
end
