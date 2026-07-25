require "rails_helper"

RSpec.describe FhirAdminGateway do
  let(:base_url) { "http://fhir.example" }
  let(:clients_url) { "#{base_url}/admin/oauth_clients" }
  let(:admin_token) { "adm-token" }

  # sleep しないウォームアップ(実時間で最大90秒待たせないため)
  let(:warmup) do
    Class.new do
      attr_reader :calls

      def initialize
        @calls = 0
      end

      def wait_until_ready(**)
        @calls += 1
        true
      end
    end.new
  end

  def config(admin_token: "adm-token", host_header: nil)
    FhirConnectionSettings::EffectiveConfig.new(
      base_url: base_url, client_id: nil, client_secret: nil,
      token_path: "/oauth/token", host_header: host_header, admin_token: admin_token
    )
  end

  def build_gateway(**overrides)
    described_class.new(config: config(**overrides), warmup: warmup)
  end

  describe "#configured?" do
    it "is false without an admin token" do
      expect(build_gateway(admin_token: nil)).not_to be_configured
      expect(build_gateway(admin_token: "")).not_to be_configured
      expect(build_gateway).to be_configured
    end

    it "raises NotConfigured rather than sending an unauthenticated request" do
      stub = stub_request(:get, clients_url)

      expect { build_gateway(admin_token: nil).request(:get, "/admin/oauth_clients") }
        .to raise_error(described_class::NotConfigured)
      expect(stub).not_to have_been_requested
    end
  end

  describe "credentials" do
    it "sends the admin token and never an Authorization header" do
      stub_request(:get, clients_url).to_return(status: 200, body: "{}")

      build_gateway.request(:get, "/admin/oauth_clients")

      expect(
        a_request(:get, clients_url).with(headers: { "X-FHIR-Admin-Token" => admin_token })
      ).to have_been_made.once
      expect(
        a_request(:get, clients_url).with { |req| req.headers.key?("Authorization") }
      ).not_to have_been_made
    end

    # FhirGateway と違い FhirTokenProvider には一切触らない。触ると管理APIの
    # 失敗が OAuth トークンの失効として現れ、原因追跡ができなくなる。
    it "never fetches an OAuth token" do
      stub_request(:get, clients_url).to_return(status: 200, body: "{}")

      build_gateway.request(:get, "/admin/oauth_clients")

      expect(a_request(:post, "#{base_url}/oauth/token")).not_to have_been_made
    end

    it "sends the Host header when one is configured" do
      stub_request(:get, clients_url).to_return(status: 200, body: "{}")

      build_gateway(host_header: "localhost:3000").request(:get, "/admin/oauth_clients")

      expect(
        a_request(:get, clients_url).with(headers: { "Host" => "localhost:3000" })
      ).to have_been_made.once
    end
  end

  describe "request bodies" do
    it "passes the body through verbatim" do
      body = '{"name":"x","scopes":["system/*.read"]}'
      stub_request(:post, clients_url).with(body: body).to_return(status: 201, body: "{}")

      response = build_gateway.request(:post, "/admin/oauth_clients", body: body)

      expect(response.status).to eq(201)
    end
  end

  describe "cold starts" do
    it "warms up once and retries after a transient 503" do
      stub_request(:get, clients_url)
        .to_return(status: 503, body: "").then
        .to_return(status: 200, body: '{"total":0}')

      response = build_gateway.request(:get, "/admin/oauth_clients")

      expect(response.status).to eq(200)
      expect(warmup.calls).to eq(1)
      expect(a_request(:get, clients_url)).to have_been_made.twice
    end

    it "warms up once and retries after a connection failure" do
      stub_request(:get, clients_url)
        .to_raise(Faraday::ConnectionFailed.new("cold")).then
        .to_return(status: 200, body: '{"total":0}')

      response = build_gateway.request(:get, "/admin/oauth_clients")

      expect(response.status).to eq(200)
      expect(warmup.calls).to eq(1)
    end

    it "gives up after a single warm-up rather than looping" do
      stub_request(:get, clients_url).to_return(status: 503, body: "")

      response = build_gateway.request(:get, "/admin/oauth_clients")

      expect(response.status).to eq(503)
      expect(warmup.calls).to eq(1)
      expect(a_request(:get, clients_url)).to have_been_made.twice
    end

    it "re-raises a connection failure that persists" do
      stub_request(:get, clients_url).to_raise(Faraday::ConnectionFailed.new("dead"))

      expect { build_gateway.request(:get, "/admin/oauth_clients") }
        .to raise_error(Faraday::ConnectionFailed)
    end
  end

  describe "401 handling" do
    # 401 は「管理トークンが違う」を意味する。リトライしても直らず、上流の
    # admin/ip スロットルを余計に消費するだけなので、絶対に再送しない。
    it "does not retry and does not warm up" do
      stub_request(:get, clients_url).to_return(status: 401, body: '{"error":"invalid_token"}')

      response = build_gateway.request(:get, "/admin/oauth_clients")

      expect(response.status).to eq(401)
      expect(warmup.calls).to eq(0)
      expect(a_request(:get, clients_url)).to have_been_made.once
    end
  end
end
