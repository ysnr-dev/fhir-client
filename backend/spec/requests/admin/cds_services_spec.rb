require "rails_helper"

RSpec.describe "Admin::CdsServices", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  let(:payload) { { name: "薬剤安全", base_url: "https://cds.example" } }

  it "lists providers in position order without the token" do
    CdsService.create!(payload.merge(name: "B", position: 2, auth_token: "secret"))
    CdsService.create!(payload.merge(name: "A", position: 1))

    with_admin_token(nil) { get "/admin/cds_services" }

    expect(response).to have_http_status(:ok)
    items = response.parsed_body["items"]
    expect(items.map { |i| i["name"] }).to eq(%w[A B])
    expect(items.last).to include("auth_token_set" => true)
    expect(items.last).not_to have_key("auth_token")
  end

  it "creates at the end, keeps the token on a blank update and deletes" do
    with_admin_token(nil) { post "/admin/cds_services", params: payload.merge(auth_token: "tok"), as: :json }
    expect(response).to have_http_status(:created)
    id = response.parsed_body["id"]

    with_admin_token(nil) { patch "/admin/cds_services/#{id}", params: { enabled: false, auth_token: "" }, as: :json }
    expect(response).to have_http_status(:ok)
    service = CdsService.find(id)
    expect(service.enabled).to be(false)
    expect(service.auth_token).to eq("tok")

    with_admin_token(nil) { delete "/admin/cds_services/#{id}" }
    expect(response).to have_http_status(:no_content)
  end

  it "returns 422 for a bad URL" do
    with_admin_token(nil) { post "/admin/cds_services", params: payload.merge(base_url: "cds"), as: :json }

    expect(response).to have_http_status(:unprocessable_content)
  end

  it "reads the discovery document on demand" do
    service = CdsService.create!(payload.merge(auth_token: "tok"))
    stub_request(:get, "https://cds.example/cds-services")
      .with(headers: { "Authorization" => "Bearer tok" })
      .to_return(status: 200, body: {
        services: [{ id: "a", hook: "patient-view", title: "A", prefetch: { patient: "Patient/{{context.patientId}}" } }]
      }.to_json)

    with_admin_token(nil) { get "/admin/cds_services/#{service.id}/discover" }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["services"]).to eq([
      { "id" => "a", "hook" => "patient-view", "title" => "A", "description" => nil, "prefetch" => ["patient"] }
    ])
  end

  it "turns a failed discovery into 502" do
    service = CdsService.create!(payload)
    stub_request(:get, "https://cds.example/cds-services").to_return(status: 500, body: "")

    with_admin_token(nil) { get "/admin/cds_services/#{service.id}/discover" }

    expect(response).to have_http_status(:bad_gateway)
    expect(response.parsed_body["error"]).to include("500")
  end

  it "requires the admin session when ADMIN_TOKEN is configured" do
    with_admin_token("s3cret") { get "/admin/cds_services" }

    expect(response).to have_http_status(:unauthorized)
  end
end
