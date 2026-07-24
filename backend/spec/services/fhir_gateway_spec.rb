require "rails_helper"

RSpec.describe FhirGateway do
  let(:base_url) { "http://fhir.example" }
  let(:token_url) { "#{base_url}/oauth/token" }

  # A token fetch first warms the (possibly spun-down) upstream via /up.
  before { stub_request(:get, "#{base_url}/up").to_return(status: 200, body: "ok") }

  def build_gateway(provider)
    described_class.new(base_url: base_url, host_header: nil, token_provider: provider)
  end

  def auth_provider
    FhirTokenProvider.new(
      base_url: base_url, client_id: "cid", client_secret: "sec", host_header: nil
    )
  end

  def no_auth_provider
    FhirTokenProvider.new(
      base_url: base_url, client_id: nil, client_secret: nil, host_header: nil
    )
  end

  it "sends no Authorization header in no-auth mode" do
    stub = stub_request(:get, "#{base_url}/Patient/p1").to_return(status: 200, body: "{}")
    gateway = build_gateway(no_auth_provider)

    response = gateway.forward(method: :get, path: "/Patient/p1")

    expect(response.status).to eq(200)
    expect(stub).to have_been_requested.once
    expect(
      a_request(:get, "#{base_url}/Patient/p1").with { |req| req.headers.key?("Authorization") }
    ).not_to have_been_made
  end

  it "attaches a Bearer token when credentials are configured" do
    stub_request(:post, token_url).to_return(
      status: 200, body: { access_token: "tok-1", expires_in: 3600 }.to_json,
      headers: { "Content-Type" => "application/json" }
    )
    stub_request(:get, "#{base_url}/Patient/p1")
      .with(headers: { "Authorization" => "Bearer tok-1" })
      .to_return(status: 200, body: "{}")
    gateway = build_gateway(auth_provider)

    response = gateway.forward(method: :get, path: "/Patient/p1")

    expect(response.status).to eq(200)
  end

  it "retries exactly once with a fresh token on 401" do
    token_calls = 0
    stub_request(:post, token_url).to_return do
      token_calls += 1
      {
        status: 200,
        body: { access_token: "tok-#{token_calls}", expires_in: 3600 }.to_json,
        headers: { "Content-Type" => "application/json" }
      }
    end
    upstream = stub_request(:get, "#{base_url}/Patient/p1")
      .to_return(status: 401, body: "{}")
      .then.to_return(status: 200, body: '{"resourceType":"Patient"}')
    gateway = build_gateway(auth_provider)

    response = gateway.forward(method: :get, path: "/Patient/p1")

    expect(response.status).to eq(200)
    expect(upstream).to have_been_requested.twice
    expect(token_calls).to eq(2)
    expect(
      a_request(:get, "#{base_url}/Patient/p1")
        .with(headers: { "Authorization" => "Bearer tok-2" })
    ).to have_been_made
  end

  it "does not retry a 401 in no-auth mode" do
    upstream = stub_request(:get, "#{base_url}/Patient/p1").to_return(status: 401, body: "{}")
    gateway = build_gateway(no_auth_provider)

    response = gateway.forward(method: :get, path: "/Patient/p1")

    expect(response.status).to eq(401)
    expect(upstream).to have_been_requested.once
  end

  it "defaults base_url from the effective connection settings when omitted" do
    FhirConnectionSettings.current.update!(base_url: "http://db.example")
    stub = stub_request(:get, "http://db.example/Patient/p1").to_return(status: 200, body: "{}")
    # base_url を渡さない → effective(DB 設定)から解決される。
    gateway = described_class.new(token_provider: no_auth_provider)

    response = gateway.forward(method: :get, path: "/Patient/p1")

    expect(response.status).to eq(200)
    expect(stub).to have_been_requested.once
  end
end
