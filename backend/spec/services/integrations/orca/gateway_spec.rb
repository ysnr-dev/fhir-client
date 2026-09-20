require "rails_helper"

RSpec.describe Integrations::Orca::Gateway do
  let(:base_url) { "http://orca.example:8000" }
  let(:url) { "#{base_url}/api/api01rv2/system01lstv2" }

  def config(**overrides)
    ExternalSystemConnection::EffectiveConfig.new(
      { system_key: "receipt_computer", system_type: "orca", enabled: true, base_url: base_url,
        username: "ormaster", password: "secret", options: { "api_prefix" => "/api" } }.merge(overrides)
    )
  end

  def gateway(**overrides) = described_class.new(config(**overrides))

  def ok_body(code = "00")
    %(<xmlio2><res type="record"><Api_Result type="string">#{code}</Api_Result></res></xmlio2>)
  end

  before { allow_any_instance_of(described_class).to receive(:sleep) }

  describe "#configured?" do
    it "needs the URL and both credentials, not just the enabled flag" do
      expect(gateway(enabled: false)).not_to be_configured
      expect(gateway(base_url: nil)).not_to be_configured
      expect(gateway(password: nil)).not_to be_configured
      expect(gateway).to be_configured
    end

    it "refuses to send when it is not configured" do
      expect { gateway(enabled: false).post("/x", "req", {}) }
        .to raise_error(described_class::NotConfigured)
    end
  end

  describe "#post" do
    it "prefixes the path, sends XML and authenticates" do
      stub = stub_request(:post, url)
             .with(headers: { "Content-Type" => "application/xml; charset=UTF-8" },
                   basic_auth: %w[ormaster secret])
             .to_return(status: 200, body: ok_body)

      result = gateway.post("/api01rv2/system01lstv2", "system01_managereq", { "Request_Number" => "01" })

      expect(stub).to have_been_requested
      expect(result).to be_ok
      expect(result.request_xml).to include("Request_Number")
    end

    it "passes the class parameter through the query string" do
      stub = stub_request(:post, "#{base_url}/api/api21/medicalmodv2?class=03")
             .to_return(status: 200, body: ok_body)

      gateway.post("/api21/medicalmodv2", "medicalreq", {}, params: { "class" => "03" })

      expect(stub).to have_been_requested
    end

    it "can talk to an 日レセ that has no /api prefix" do
      stub = stub_request(:post, "#{base_url}/api01rv2/system01lstv2").to_return(status: 200, body: ok_body)

      gateway(options: { "api_prefix" => "" }).post("/api01rv2/system01lstv2", "req", {})

      expect(stub).to have_been_requested
    end

    # 医事課が画面を触っていると他端末使用中になる。待てば空くので送り直す。
    it "retries while the 日レセ says another terminal is using it" do
      stub_request(:post, url)
        .to_return({ status: 200, body: ok_body("90") }, { status: 200, body: ok_body("00") })

      expect(gateway.post("/api01rv2/system01lstv2", "req", {})).to be_ok
    end

    it "gives up and reports the busy result rather than looping forever" do
      stub_request(:post, url).to_return(status: 200, body: ok_body("90"))

      result = gateway.post("/api01rv2/system01lstv2", "req", {})

      expect(result).not_to be_ok
      expect(result.api_result.code).to eq("90")
    end

    # クラウド版は起動直後に 503 +「マスター更新中です」を返す。
    it "retries a transient 503" do
      stub_request(:post, url)
        .to_return({ status: 503, body: "" }, { status: 200, body: ok_body })

      expect(gateway.post("/api01rv2/system01lstv2", "req", {})).to be_ok
    end

    it "does not retry a business error such as 同日データあり" do
      stub = stub_request(:post, url).to_return(status: 200, body: ok_body("80"))

      result = gateway.post("/api01rv2/system01lstv2", "req", {})

      expect(result.api_result.code).to eq("80")
      expect(stub).to have_been_requested.once
    end

    it "raises when the 日レセ returns something that is not a response" do
      stub_request(:post, url).to_return(status: 200, body: "<html>401</html>")

      expect { gateway.post("/api01rv2/system01lstv2", "req", {}) }
        .to raise_error(described_class::InvalidResponse, /XML として読めません/)
    end

    it "raises on a non-2xx that will not resolve by waiting" do
      stub_request(:post, url).to_return(status: 401, body: "")

      expect { gateway.post("/api01rv2/system01lstv2", "req", {}) }
        .to raise_error(described_class::InvalidResponse, /HTTP 401/)
    end
  end

  describe "#get" do
    # patientgetv2 だけは GET。
    it "sends query parameters instead of a body" do
      stub = stub_request(:get, "#{base_url}/api/api01rv2/patientgetv2?id=00001")
             .to_return(status: 200, body: ok_body)

      expect(gateway.get("/api01rv2/patientgetv2", { "id" => "00001" })).to be_ok
      expect(stub).to have_been_requested
    end
  end
end
