require "rails_helper"

RSpec.describe "Master::LineDrainTypes", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  it "lists types in display order and filters by kind and enabled" do
    Master::LineDrainType.create!(code: "foley", name: "尿道留置カテーテル", kind: "urinary", warn_days: 7, display_order: 60)
    Master::LineDrainType.create!(code: "picc", name: "PICC", kind: "vascular-central", warn_days: 30, display_order: 20, enabled: false)
    Master::LineDrainType.create!(code: "cvc", name: "中心静脈カテーテル", kind: "vascular-central", warn_days: 14, display_order: 10)

    with_admin_token(nil) { get "/master/line_drain_types" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["items"].map { |i| i["code"] }).to eq(%w[cvc picc foley])

    with_admin_token(nil) { get "/master/line_drain_types", params: { kind: "vascular-central", enabled: "true" } }
    expect(response.parsed_body["items"].map { |i| i["code"] }).to eq(%w[cvc])
  end

  it "creates, casts warn_days, updates by code and rejects a bad kind" do
    with_admin_token(nil) do
      post "/master/line_drain_types", params: { code: "ngt", name: "経鼻胃管", kind: "gi", warn_days: "14" }, as: :json
    end
    expect(response).to have_http_status(:created)
    expect(Master::LineDrainType.find_by(code: "ngt").warn_days).to eq(14)

    with_admin_token(nil) { patch "/master/line_drain_types/ngt", params: { warn_days: nil }, as: :json }
    expect(response).to have_http_status(:ok)
    expect(Master::LineDrainType.find_by(code: "ngt").warn_days).to be_nil

    with_admin_token(nil) { post "/master/line_drain_types", params: { code: "x", name: "x", kind: "unknown" }, as: :json }
    expect(response).to have_http_status(:unprocessable_content)
  end
end
