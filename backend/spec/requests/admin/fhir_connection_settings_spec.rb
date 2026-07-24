require "rails_helper"

RSpec.describe "Admin::FhirConnectionSettings", type: :request do
  describe "GET /admin/fhir_connection_settings" do
    it "returns settings without the secret and reports whether it is set" do
      FhirConnectionSettings.current.update!(
        base_url: "http://db.example", client_id: "cid", client_secret: "sec"
      )

      get "/admin/fhir_connection_settings"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).not_to have_key("client_secret")
      expect(body["client_secret_set"]).to be(true)
      expect(body["client_id"]).to eq("cid")
      expect(body["base_url"]).to eq("http://db.example")
      expect(body["auth_enabled"]).to be(true)
      expect(body["effective_auth_source"]).to eq("db")
    end

    it "reports client_secret_set false when unset" do
      get "/admin/fhir_connection_settings"

      body = JSON.parse(response.body)
      expect(body["client_secret_set"]).to be(false)
    end
  end

  describe "PATCH /admin/fhir_connection_settings" do
    it "updates fields and sets the secret only when provided" do
      patch "/admin/fhir_connection_settings",
        params: { base_url: "http://new.example", client_id: "c1", client_secret: "s1" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(FhirConnectionSettings.current.base_url).to eq("http://new.example")
      expect(FhirConnectionSettings.current.client_secret).to eq("s1")

      # secret を空で送っても既存値は保持される。
      patch "/admin/fhir_connection_settings",
        params: { base_url: "http://new2.example", client_secret: "" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(FhirConnectionSettings.current.base_url).to eq("http://new2.example")
      expect(FhirConnectionSettings.current.client_secret).to eq("s1")

      body = JSON.parse(response.body)
      expect(body).not_to have_key("client_secret")
    end

    it "rebuilds the token provider singleton on save" do
      expect(FhirTokenProvider).to receive(:reset_default!)

      patch "/admin/fhir_connection_settings",
        params: { base_url: "http://x.example" }, as: :json
    end
  end

  describe "POST /admin/fhir_connection_settings/test" do
    it "reports success in no-auth mode when /metadata is reachable" do
      FhirConnectionSettings.current.update!(base_url: "http://t.example")
      stub_request(:get, "http://t.example/metadata").to_return(status: 200, body: "{}")

      post "/admin/fhir_connection_settings/test"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["ok"]).to be(true)
      expect(body["auth"]).to eq("none")
    end

    it "reports success with credentials by fetching a token" do
      FhirConnectionSettings.current.update!(
        base_url: "http://t.example", client_id: "cid", client_secret: "sec"
      )
      stub_request(:get, "http://t.example/up").to_return(status: 200, body: "ok")
      stub_request(:post, "http://t.example/oauth/token").to_return(
        status: 200, body: { access_token: "tok", expires_in: 3600 }.to_json,
        headers: { "Content-Type" => "application/json" }
      )

      post "/admin/fhir_connection_settings/test"

      body = JSON.parse(response.body)
      expect(body["ok"]).to be(true)
      expect(body["auth"]).to eq("backend_services")
    end

    it "reports failure (without leaking details) when the token endpoint rejects" do
      FhirConnectionSettings.current.update!(
        base_url: "http://t.example", client_id: "cid", client_secret: "sec"
      )
      stub_request(:get, "http://t.example/up").to_return(status: 200, body: "ok")
      stub_request(:post, "http://t.example/oauth/token").to_return(
        status: 400, body: { error: "invalid_client" }.to_json
      )

      post "/admin/fhir_connection_settings/test"

      body = JSON.parse(response.body)
      expect(body["ok"]).to be(false)
      expect(body["error"]).to be_present
      expect(response.body).not_to include("invalid_client")
    end
  end

  describe "optional ADMIN_TOKEN guard" do
    around do |example|
      ENV["ADMIN_TOKEN"] = "s3cret"
      example.run
    ensure
      ENV.delete("ADMIN_TOKEN")
    end

    it "rejects requests without a matching token" do
      get "/admin/fhir_connection_settings"
      expect(response).to have_http_status(:unauthorized)
    end

    it "allows requests with a matching Bearer token" do
      get "/admin/fhir_connection_settings", headers: { "Authorization" => "Bearer s3cret" }
      expect(response).to have_http_status(:ok)
    end
  end
end
