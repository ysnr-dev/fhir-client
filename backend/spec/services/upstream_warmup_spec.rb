require "rails_helper"

RSpec.describe UpstreamWarmup do
  let(:base_url) { "http://fhir.example" }
  let(:up_url) { "#{base_url}/up" }

  def wait(sleeper: ->(_seconds) {}, host_header: nil)
    described_class.wait_until_ready(base_url: base_url, host_header: host_header, sleeper: sleeper)
  end

  it "returns immediately when the upstream is already up" do
    stub_request(:get, up_url).to_return(status: 200, body: "ok")
    slept = []

    expect(wait(sleeper: ->(seconds) { slept << seconds })).to be(true)
    expect(a_request(:get, up_url)).to have_been_made.once
    expect(slept).to be_empty
  end

  it "polls until the upstream becomes ready" do
    stub_request(:get, up_url)
      .to_return(status: 503, body: "").then
      .to_return(status: 200, body: "ok")
    slept = []

    expect(wait(sleeper: ->(seconds) { slept << seconds })).to be(true)
    expect(a_request(:get, up_url)).to have_been_made.twice
    expect(slept).to eq([described_class::POLL_INTERVAL])
  end

  # ベストエフォート: 起きてこなくても例外にせず false を返し、判断は呼び出し側に委ねる。
  it "gives up after MAX_ATTEMPTS without raising" do
    stub_request(:get, up_url).to_raise(Faraday::ConnectionFailed.new("cold"))

    expect(wait).to be(false)
    expect(a_request(:get, up_url)).to have_been_made.times(described_class::MAX_ATTEMPTS)
  end

  it "sends the Host header when one is given" do
    stub_request(:get, up_url).to_return(status: 200, body: "ok")

    wait(host_header: "localhost:3000")

    expect(a_request(:get, up_url).with(headers: { "Host" => "localhost:3000" }))
      .to have_been_made.once
  end

  it "tolerates a trailing slash on the base URL" do
    stub_request(:get, up_url).to_return(status: 200, body: "ok")

    described_class.wait_until_ready(base_url: "#{base_url}/", sleeper: ->(_s) {})

    expect(a_request(:get, up_url)).to have_been_made.once
  end
end
