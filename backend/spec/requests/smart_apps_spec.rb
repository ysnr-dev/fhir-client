require "rails_helper"

RSpec.describe "SmartApps (karte tab)", type: :request do
  let(:admin_token) { "s3cret-admin-passphrase" }
  let(:base_url) { "http://fhir.example" }
  let(:upstream) { "#{base_url}/admin/launch_contexts" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def login_as_practitioner
    User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
    post "/auth/session", params: { login_id: "tanaka", password: "password123" }, as: :json
    expect(response).to have_http_status(:ok)
    response.parsed_body["csrf_token"]
  end

  def login_as_administrator
    post "/auth/session", params: { login_id: "administrator", password: admin_token }, as: :json
    expect(response).to have_http_status(:ok)
    response.parsed_body["csrf_token"]
  end

  let!(:smart_app) do
    SmartApp.create!(name: "計算ツール", client_id: "c1", launch_url: "https://app.example/launch?mode=karte")
  end

  before do
    FhirConnectionSettings.current.update!(
      base_url: base_url, public_base_url: "http://localhost:3000/", fhir_admin_token: "upstream-admin"
    )
    stub_request(:get, "#{base_url}/up").to_return(status: 200, body: "ok")
  end

  describe "GET /smart_apps" do
    it "lists only enabled apps with what the tab needs" do
      SmartApp.create!(name: "停止中", client_id: "c2", launch_url: "https://x.example/", enabled: false)

      with_admin_token(nil) { get "/smart_apps" }

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["items"]).to eq([{ "id" => smart_app.id, "name" => "計算ツール", "display" => "embed" }])
    end
  end

  describe "POST /smart_apps/:id/launch" do
    it "mints a launch at the upstream and returns the launch URL with iss and launch" do
      stub_request(:post, upstream)
        .with(body: hash_including("client_id" => "c1", "patient_id" => "p-1", "encounter_id" => "e-1",
                                   "practitioner_id" => "prac-1", "need_patient_banner" => false,
                                   "issued_by" => "fhir-client"),
              headers: { "X-FHIR-Admin-Token" => "upstream-admin" })
        .to_return(status: 201, body: { launch: "abc123", expires_in: 300 }.to_json,
                   headers: { "Content-Type" => "application/json" })

      with_admin_token do
        csrf = login_as_practitioner
        post "/smart_apps/#{smart_app.id}/launch", params: { patient_id: "p-1", encounter_id: "e-1" },
                                             headers: { "X-CSRF-Token" => csrf }, as: :json
      end

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["display"]).to eq("embed")
      expect(body["expires_in"]).to eq(300)
      query = Rack::Utils.parse_query(URI.parse(body["launch_url"]).query)
      expect(body["launch_url"]).to start_with("https://app.example/launch?")
      expect(query).to eq("mode" => "karte", "iss" => "http://localhost:3000", "launch" => "abc123")
    end

    it "asks for a patient banner when the app opens in a window" do
      smart_app.update!(display: "window")
      stub_request(:post, upstream).with(body: hash_including("need_patient_banner" => true))
                                   .to_return(status: 201, body: { launch: "x", expires_in: 300 }.to_json)

      with_admin_token do
        csrf = login_as_practitioner
        post "/smart_apps/#{smart_app.id}/launch", params: { patient_id: "p-1" }, headers: { "X-CSRF-Token" => csrf }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["display"]).to eq("window")
    end

    it "refuses the administrator, who has no practitioner to launch as" do
      with_admin_token do
        csrf = login_as_administrator
        post "/smart_apps/#{smart_app.id}/launch", params: { patient_id: "p-1" }, headers: { "X-CSRF-Token" => csrf }, as: :json
      end

      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]).to eq("practitioner_required")
    end

    it "refuses the no-auth mode for the same reason" do
      with_admin_token(nil) { post "/smart_apps/#{smart_app.id}/launch", params: { patient_id: "p-1" }, as: :json }

      expect(response).to have_http_status(:forbidden)
    end

    it "requires a patient and an enabled app" do
      with_admin_token do
        csrf = login_as_practitioner
        post "/smart_apps/#{smart_app.id}/launch", params: {}, headers: { "X-CSRF-Token" => csrf }, as: :json
        expect(response).to have_http_status(:bad_request)

        smart_app.update!(enabled: false)
        post "/smart_apps/#{smart_app.id}/launch", params: { patient_id: "p-1" }, headers: { "X-CSRF-Token" => csrf }, as: :json
        expect(response).to have_http_status(:not_found)
      end
    end

    it "passes the upstream 422 reasons through" do
      stub_request(:post, upstream).to_return(
        status: 422, body: { errors: ["client is not registered for EHR launch (scope 'launch' is required)"] }.to_json
      )

      with_admin_token do
        csrf = login_as_practitioner
        post "/smart_apps/#{smart_app.id}/launch", params: { patient_id: "p-1" }, headers: { "X-CSRF-Token" => csrf }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"].first).to include("launch")
    end

    it "turns an upstream 401 into 502 so the SPA does not log the user out" do
      stub_request(:post, upstream).to_return(status: 401, body: { error: "invalid_token" }.to_json)

      with_admin_token do
        csrf = login_as_practitioner
        post "/smart_apps/#{smart_app.id}/launch", params: { patient_id: "p-1" }, headers: { "X-CSRF-Token" => csrf }, as: :json
      end

      expect(response).to have_http_status(:bad_gateway)
      expect(response.parsed_body["error"]).to include("管理トークン")
    end

    it "returns 503 when the admin token is not configured" do
      FhirConnectionSettings.current.update!(fhir_admin_token: nil)

      with_admin_token do
        csrf = login_as_practitioner
        post "/smart_apps/#{smart_app.id}/launch", params: { patient_id: "p-1" }, headers: { "X-CSRF-Token" => csrf }, as: :json
      end

      expect(response).to have_http_status(:service_unavailable)
    end
  end
end
