require "rails_helper"

RSpec.describe CdsService do
  def build(attrs = {})
    described_class.new({ name: "薬剤安全", base_url: "https://cds.example/" }.merge(attrs))
  end

  it "is valid with a name and an absolute base URL" do
    expect(build).to be_valid
  end

  it "rejects a relative or malformed base URL" do
    expect(build(base_url: "/cds")).not_to be_valid
    expect(build(base_url: "::bad")).not_to be_valid
  end

  it "accepts http outside production only" do
    expect(build(base_url: "http://localhost:8787")).to be_valid

    allow(Rails.env).to receive(:production?).and_return(true)
    expect(build(base_url: "http://localhost:8787")).not_to be_valid
  end
end
