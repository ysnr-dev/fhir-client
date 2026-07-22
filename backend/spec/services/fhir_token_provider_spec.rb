require "rails_helper"

RSpec.describe FhirTokenProvider do
  let(:base_url) { "http://fhir.example" }
  let(:token_url) { "#{base_url}/oauth/token" }

  def build_provider(client_id: "cid", client_secret: "sec", clock: nil)
    described_class.new(
      base_url: base_url,
      client_id: client_id,
      client_secret: client_secret,
      host_header: nil,
      clock: clock
    )
  end

  def stub_token(access_token: "tok-1", expires_in: 3600, status: 200, body: nil)
    body ||= { access_token: access_token, token_type: "Bearer", expires_in: expires_in }
    stub_request(:post, token_url).to_return(
      status: status, body: body.to_json, headers: { "Content-Type" => "application/json" }
    )
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

    it "raises when the response has no access_token" do
      stub_token(body: { token_type: "Bearer" })
      provider = build_provider

      expect { provider.access_token }.to raise_error(
        FhirTokenProvider::TokenError, /access_token/
      )
    end
  end
end
