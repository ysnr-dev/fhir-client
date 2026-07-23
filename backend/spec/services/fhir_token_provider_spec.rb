require "rails_helper"

RSpec.describe FhirTokenProvider do
  let(:base_url) { "http://fhir.example" }
  let(:token_url) { "#{base_url}/oauth/token" }
  let(:up_url) { "#{base_url}/up" }

  # No-op sleeper so retry backoff doesn't actually block the suite.
  def build_provider(client_id: "cid", client_secret: "sec", clock: nil, sleeper: ->(_seconds) {})
    described_class.new(
      base_url: base_url,
      client_id: client_id,
      client_secret: client_secret,
      host_header: nil,
      clock: clock,
      sleeper: sleeper
    )
  end

  def stub_token(access_token: "tok-1", expires_in: 3600, status: 200, body: nil)
    body ||= { access_token: access_token, token_type: "Bearer", expires_in: expires_in }
    stub_request(:post, token_url).to_return(
      status: status, body: body.to_json, headers: { "Content-Type" => "application/json" }
    )
  end

  def stub_up(status: 200)
    stub_request(:get, up_url).to_return(status: status, body: "ok")
  end

  describe "no-auth mode" do
    it "returns nil and never calls the token endpoint when credentials are unset" do
      provider = build_provider(client_id: nil, client_secret: nil)
      expect(provider.enabled?).to be(false)
      expect(provider.access_token).to be_nil
      expect(a_request(:post, token_url)).not_to have_been_made
    end
  end

  describe "#access_token" do
    before { stub_up }

    it "fetches with client_credentials and caches the token" do
      stub = stub_token
      provider = build_provider

      expect(provider.access_token).to eq("tok-1")
      expect(provider.access_token).to eq("tok-1")

      expect(stub).to have_been_requested.once
      expect(
        a_request(:post, token_url).with(
          body: URI.encode_www_form(
            grant_type: "client_credentials", client_id: "cid", client_secret: "sec"
          )
        )
      ).to have_been_made
    end

    it "refreshes proactively after 90% of expires_in" do
      stub = stub_token
      now = 0.0
      provider = build_provider(clock: -> { now })

      provider.access_token
      now = (3600 * 0.9) - 1
      provider.access_token
      expect(stub).to have_been_requested.once

      now = (3600 * 0.9) + 1
      provider.access_token
      expect(stub).to have_been_requested.twice
    end

    it "refetches after invalidate!" do
      stub = stub_token
      provider = build_provider

      provider.access_token
      provider.invalidate!
      provider.access_token

      expect(stub).to have_been_requested.twice
    end

    it "raises on a non-2xx response without leaking the body" do
      stub_token(status: 400, body: { error: "invalid_client" })
      provider = build_provider

      expect { provider.access_token }.to raise_error(FhirTokenProvider::TokenError) do |error|
        expect(error.message).to include("HTTP 400")
        expect(error.message).not_to include("invalid_client")
      end
    end

    it "does not retry a non-transient failure (e.g. 400)" do
      stub = stub_token(status: 400, body: { error: "invalid_client" })
      provider = build_provider

      expect { provider.access_token }.to raise_error(FhirTokenProvider::TokenError)
      expect(stub).to have_been_requested.once
    end

    it "warms up the upstream via /up before fetching the token" do
      up = stub_up
      stub_token
      provider = build_provider

      provider.access_token

      expect(up).to have_been_requested.once
    end

    it "still fetches the token when the warm-up request fails" do
      stub_request(:get, up_url).to_raise(Faraday::ConnectionFailed.new("cold"))
      stub_token
      provider = build_provider

      expect(provider.access_token).to eq("tok-1")
    end

    it "retries a transient 502 (cold start) and then succeeds" do
      stub_request(:post, token_url)
        .to_return(status: 502, body: "")
        .to_return(status: 200,
                   body: { access_token: "tok-1", token_type: "Bearer", expires_in: 3600 }.to_json,
                   headers: { "Content-Type" => "application/json" })
      slept = []
      provider = build_provider(sleeper: ->(seconds) { slept << seconds })

      expect(provider.access_token).to eq("tok-1")
      expect(a_request(:post, token_url)).to have_been_made.twice
      expect(slept).to eq([FhirTokenProvider::RETRY_BACKOFF.first])
    end

    it "retries a connection timeout and then succeeds" do
      stub_request(:post, token_url)
        .to_raise(Faraday::TimeoutError)
        .to_return(status: 200,
                   body: { access_token: "tok-1", expires_in: 3600 }.to_json,
                   headers: { "Content-Type" => "application/json" })
      provider = build_provider

      expect(provider.access_token).to eq("tok-1")
      expect(a_request(:post, token_url)).to have_been_made.twice
    end

    it "gives up with a TokenError after the retry window is exhausted" do
      stub_request(:post, token_url).to_return(status: 502, body: "")
      provider = build_provider

      expect { provider.access_token }.to raise_error(FhirTokenProvider::TokenError, /HTTP 502/)
      # initial attempt + one per backoff step
      expect(a_request(:post, token_url))
        .to have_been_made.times(FhirTokenProvider::RETRY_BACKOFF.size + 1)
    end

    it "raises when the response has no access_token" do
      stub_token(body: { token_type: "Bearer" })
      provider = build_provider

      expect { provider.access_token }.to raise_error(
        FhirTokenProvider::TokenError, /access_token/
      )
    end
  end
end
