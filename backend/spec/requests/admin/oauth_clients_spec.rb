require "rails_helper"

RSpec.describe "Admin::OauthClients (relay to the upstream admin API)", type: :request do
  let(:base_url) { "http://fhir.example" }
  let(:upstream) { "#{base_url}/admin/oauth_clients" }
  let(:admin_token) { "zz-upstream-admin-token" }

  before do
    FhirConnectionSettings.current.update!(base_url: base_url, fhir_admin_token: admin_token)
    # transient 失敗のときゲートウェイは /up でウォームアップを試みる。即 200 を
    # 返させて、テストが実際に sleep しないようにする。
    stub_request(:get, "#{base_url}/up").to_return(status: 200, body: "ok")
  end

  describe "GET /admin/oauth_clients" do
    it "passes the upstream body and status through" do
      body = { total: 1, items: [{ client_id: "c1", name: "x" }] }.to_json
      stub_request(:get, upstream).to_return(
        status: 200, body: body, headers: { "Content-Type" => "application/json" }
      )

      get "/admin/oauth_clients"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq(JSON.parse(body))
      expect(a_request(:get, upstream).with(headers: { "X-FHIR-Admin-Token" => admin_token }))
        .to have_been_made.once
    end
  end

  describe "POST /admin/oauth_clients" do
    it "forwards the request body verbatim" do
      payload = { name: "my-app", scopes: ["system/Patient.read"] }
      stub_request(:post, upstream)
        .with(body: payload.to_json)
        .to_return(status: 201, body: { client_id: "c1", client_secret: "raw" }.to_json,
                   headers: { "Content-Type" => "application/json" })

      post "/admin/oauth_clients", params: payload.to_json,
                                   headers: { "CONTENT_TYPE" => "application/json" }

      expect(response).to have_http_status(:created)
      # 一度だけ表示するシークレットは SPA まで届かなければならない
      expect(JSON.parse(response.body)["client_secret"]).to eq("raw")
    end

    it "passes a 422 validation body through untouched" do
      errors = { errors: ["Scopes cannot mix system/ and patient/ scopes"] }
      stub_request(:post, upstream).to_return(
        status: 422, body: errors.to_json, headers: { "Content-Type" => "application/json" }
      )

      post "/admin/oauth_clients", params: {}.to_json, headers: { "CONTENT_TYPE" => "application/json" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq(JSON.parse(errors.to_json))
    end
  end

  describe "DELETE /admin/oauth_clients/:id" do
    it "relays the delete and its summary" do
      id = SecureRandom.uuid
      stub_request(:delete, "#{upstream}/#{id}").to_return(
        status: 200, body: { client_id: id, deleted: { access_tokens: 2 } }.to_json,
        headers: { "Content-Type" => "application/json" }
      )

      delete "/admin/oauth_clients/#{id}"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["deleted"]["access_tokens"]).to eq(2)
    end

    it "rejects an id that is not a UUID without calling upstream" do
      stub = stub_request(:delete, %r{#{Regexp.escape(upstream)}/.*})

      delete "/admin/oauth_clients/..%2Fpatients"

      expect(response).to have_http_status(:not_found)
      expect(stub).not_to have_been_requested
    end
  end

  describe "upstream error translation" do
    # ここが中継の要。上流の401をそのまま返すと、SPA の 401 ハンドラが
    # 「セッション切れ」と解釈してログアウトさせてしまう。実際にはサーバー側の
    # 管理トークン設定ミスなので、502 に読み替える。
    it "turns an upstream 401 into a 502, never a 401" do
      stub_request(:get, upstream).to_return(status: 401, body: '{"error":"invalid_token"}')

      get "/admin/oauth_clients"

      expect(response).not_to have_http_status(:unauthorized)
      expect(response).to have_http_status(:bad_gateway)
      expect(JSON.parse(response.body)["error"]).to include("管理トークンを拒否")
    end

    # 上流アプリ自身の 503(管理API無効)は設定を直すまで変わらないので、
    # エッジ由来の 503 と違ってウォームアップも再送もしてはいけない。
    it "turns an upstream 503 (admin API disabled) into a 502 without retrying" do
      stub_request(:get, upstream).to_return(status: 503, body: '{"error":"admin_api_disabled"}')

      get "/admin/oauth_clients"

      expect(response).to have_http_status(:bad_gateway)
      expect(JSON.parse(response.body)["error"]).to include("FHIR_ADMIN_TOKEN")
      expect(a_request(:get, upstream)).to have_been_made.once
      expect(a_request(:get, "#{base_url}/up")).not_to have_been_made
    end

    it "warms up and retries an edge 503 that is not the disabled marker" do
      stub_request(:get, upstream)
        .to_return(status: 503, body: "<html>service unavailable</html>").then
        .to_return(status: 200, body: '{"total":0,"items":[]}')

      get "/admin/oauth_clients"

      expect(response).to have_http_status(:ok)
      expect(a_request(:get, "#{base_url}/up")).to have_been_made.once
    end

    it "relays a 429 with a renderable message" do
      stub_request(:get, upstream).to_return(status: 429, body: '{"resourceType":"OperationOutcome"}')

      get "/admin/oauth_clients"

      expect(response).to have_http_status(:too_many_requests)
      expect(JSON.parse(response.body)["error"]).to include("レート制限")
    end

    it "does not forward an upstream 500 body" do
      stub_request(:get, upstream).to_return(status: 500, body: "internal detail leak")

      get "/admin/oauth_clients"

      expect(response).to have_http_status(:bad_gateway)
      expect(response.body).not_to include("internal detail leak")
    end

    it "answers 502 when the upstream is unreachable" do
      stub_request(:get, upstream).to_raise(Faraday::ConnectionFailed.new("down"))

      get "/admin/oauth_clients"

      expect(response).to have_http_status(:bad_gateway)
      expect(JSON.parse(response.body)["error"]).to include("接続できませんでした")
    end

    it "answers 503 when no admin token is configured" do
      FhirConnectionSettings.current.update!(fhir_admin_token: nil)
      previous = ENV.delete("FHIR_ADMIN_TOKEN")

      get "/admin/oauth_clients"

      expect(response).to have_http_status(:service_unavailable)
      expect(JSON.parse(response.body)["error"]).to include("FHIR 管理トークン")
    ensure
      ENV["FHIR_ADMIN_TOKEN"] = previous if previous
    end
  end

  describe "access control" do
    around do |example|
      ENV["ADMIN_TOKEN"] = "s3cret"
      example.run
    ensure
      ENV.delete("ADMIN_TOKEN")
    end

    it "requires a session or the admin header" do
      get "/admin/oauth_clients"

      expect(response).to have_http_status(:unauthorized)
    end

    it "allows the header-authenticated path" do
      stub_request(:get, upstream).to_return(status: 200, body: '{"total":0,"items":[]}')

      get "/admin/oauth_clients", headers: { "X-Admin-Token" => "s3cret" }

      expect(response).to have_http_status(:ok)
    end
  end

  describe "GET /admin/scopes" do
    it "relays the upstream scope options" do
      stub_request(:get, "#{base_url}/admin/scopes").to_return(
        status: 200, body: { resource_types: [{ type: "*", label: "すべての診療記録" }] }.to_json,
        headers: { "Content-Type" => "application/json" }
      )

      get "/admin/scopes"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["resource_types"].first["type"]).to eq("*")
    end
  end
end
