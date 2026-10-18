require "rails_helper"

RSpec.describe SmartApp do
  def build(attrs = {})
    described_class.new({ name: "計算ツール", client_id: SecureRandom.uuid,
                          launch_url: "https://app.example/launch" }.merge(attrs))
  end

  it "is valid with a name, a client_id and an absolute launch URL" do
    expect(build).to be_valid
    expect(build.display).to eq("embed")
    expect(build.enabled).to be(true)
  end

  it "rejects a malformed client_id and a duplicate" do
    expect(build(client_id: "not a uuid!")).not_to be_valid

    build(client_id: "abc-123").save!
    expect(build(client_id: "abc-123")).not_to be_valid
  end

  it "rejects a relative or malformed launch URL" do
    expect(build(launch_url: "/launch")).not_to be_valid
    expect(build(launch_url: "http://")).not_to be_valid
    expect(build(launch_url: "::not a url")).not_to be_valid
  end

  it "accepts http outside production only" do
    expect(build(launch_url: "http://localhost:5173/smart-demo/index.html")).to be_valid

    allow(Rails.env).to receive(:production?).and_return(true)
    expect(build(launch_url: "http://localhost:5173/smart-demo/index.html")).not_to be_valid
  end

  it "rejects an unknown display" do
    expect(build(display: "popup")).not_to be_valid
  end
end
