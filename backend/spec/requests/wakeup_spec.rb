require "rails_helper"

RSpec.describe "Wakeup", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }
  let(:up_url) { "#{upstream_base}/up" }

  it "reports both sides ready when the upstream answers /up" do
    stub_request(:get, up_url).to_return(status: 200, body: "ok")

    get "/wakeup"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body)
      .to eq("backend" => "ready", "upstream" => "ready", "upstream_probe_url" => up_url)
  end

  # 上流が起動中でも待ち切らずに即返す(待ちはクライアント側のポーリング)。
  it "reports the upstream as waking when the probe fails" do
    stub_request(:get, up_url).to_raise(Faraday::ConnectionFailed.new("cold"))

    get "/wakeup"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("backend" => "ready", "upstream" => "waking")
    expect(a_request(:get, up_url)).to have_been_made.once
  end

  # 上流を起こすのはブラウザ(backend からのプローブは Render の内部経路に落ちて
  # 起動トリガーにならない)。宛先を返せなければボタンは何も起こせない。
  it "always hands the browser the URL to poke" do
    stub_request(:get, up_url).to_raise(Faraday::ConnectionFailed.new("cold"))

    get "/wakeup"

    expect(response.parsed_body["upstream_probe_url"]).to eq(up_url)
  end

  # 設定行が引けなくても(DB が寝ている等)、起こす宛先だけは env から返す。
  it "falls back to the env base URL when the settings row cannot be read" do
    allow(FhirConnectionSettings).to receive(:effective).and_raise(ActiveRecord::ConnectionNotEstablished)

    get "/wakeup"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body)
      .to eq("backend" => "ready", "upstream" => "waking", "upstream_probe_url" => up_url)
    expect(a_request(:get, up_url)).not_to have_been_made
  end

  it "reports the upstream as waking on a 5xx from the gateway" do
    stub_request(:get, up_url).to_return(status: 503, body: "")

    get "/wakeup"

    expect(response.parsed_body["upstream"]).to eq("waking")
  end
end
