require "rails_helper"

RSpec.describe "Wakeup", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }
  let(:up_url) { "#{upstream_base}/up" }

  it "reports both sides ready when the upstream answers /up" do
    stub_request(:get, up_url).to_return(status: 200, body: "ok")

    get "/wakeup"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("backend" => "ready", "upstream" => "ready")
  end

  # 上流が起動中でも待ち切らずに即返す(待ちはクライアント側のポーリング)。
  it "reports the upstream as waking when the probe fails" do
    stub_request(:get, up_url).to_raise(Faraday::ConnectionFailed.new("cold"))

    get "/wakeup"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("backend" => "ready", "upstream" => "waking")
    expect(a_request(:get, up_url)).to have_been_made.once
  end

  it "reports the upstream as waking on a 5xx from the gateway" do
    stub_request(:get, up_url).to_return(status: 503, body: "")

    get "/wakeup"

    expect(response.parsed_body["upstream"]).to eq("waking")
  end
end
