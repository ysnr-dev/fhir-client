require "rails_helper"

RSpec.describe "Admin::ExternalSystems", type: :request do
  let(:system_key) { ExternalSystemConnection::RECEIPT_COMPUTER }

  after { ExternalSystemConnection.reset_cache! }

  describe "GET /admin/external_systems" do
    it "lists every defined system with its enabled state" do
      get "/admin/external_systems"

      expect(response).to have_http_status(:ok)
      items = JSON.parse(response.body)["items"]
      expect(items.map { |i| i["key"] }).to eq(Integrations::ExternalSystems.keys)

      receipt = items.find { |i| i["key"] == system_key }
      expect(receipt["label"]).to eq("医事会計")
      expect(receipt["enabled"]).to be(false)
      expect(receipt["usable"]).to be(false)
    end
  end

  describe "GET /admin/external_systems/:key" do
    it "returns what the settings page needs to draw itself" do
      ExternalSystemConnection.current(system_key)
                              .update!(system_type: "orca", enabled: true,
                                       base_url: "http://orca.example:8000",
                                       username: "ormaster", password: "secret")

      get "/admin/external_systems/#{system_key}"

      body = JSON.parse(response.body)
      expect(body["sections"]).to eq(%w[connection inbound_token code_mappings])
      expect(body["system_types"]).to eq(%w[orca])
      expect(body["option_fields"].map { |f| f["key"] }).to eq(%w[api_prefix])
      expect(body["code_kinds"].map { |k| k["key"] }).to eq(%w[department physician])
      expect(body["usable"]).to be(true)
    end

    it "does not return the password, only whether it is set" do
      ExternalSystemConnection.current(system_key).update!(password: "zz-secret-9")

      get "/admin/external_systems/#{system_key}"

      expect(response.body).not_to include("zz-secret-9")
      body = JSON.parse(response.body)
      expect(body).not_to have_key("password")
      expect(body["password_set"]).to be(true)
    end

    it "is 404 for a system that is not defined" do
      get "/admin/external_systems/unknown_system"

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "PATCH /admin/external_systems/:key" do
    it "saves the enabled flag per system" do
      patch "/admin/external_systems/#{system_key}", params: { enabled: true }, as: :json

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["enabled"]).to be(true)
      expect(ExternalSystemConnection.current(system_key).enabled).to be(true)
    end

    it "keeps the stored password when the field is left empty" do
      ExternalSystemConnection.current(system_key).update!(password: "kept")

      patch "/admin/external_systems/#{system_key}", params: { username: "other", password: "" }, as: :json

      row = ExternalSystemConnection.current(system_key)
      expect(row.username).to eq("other")
      expect(row.password).to eq("kept")
    end
  end

  describe "POST /admin/external_systems/:key/regenerate_inbound_token" do
    it "returns the new token in plain text so it can be handed to the agent" do
      post "/admin/external_systems/#{system_key}/regenerate_inbound_token"

      token = JSON.parse(response.body)["inbound_token"]
      expect(token).to be_present
      expect(ExternalSystemConnection.current(system_key).inbound_token).to eq(token)
    end
  end

  describe "POST /admin/external_systems/:key/test" do
    it "refuses to call the system while the connection is incomplete" do
      post "/admin/external_systems/#{system_key}/test"

      body = JSON.parse(response.body)
      expect(body["ok"]).to be(false)
      expect(body["error"]).to be_present
    end
  end
end
