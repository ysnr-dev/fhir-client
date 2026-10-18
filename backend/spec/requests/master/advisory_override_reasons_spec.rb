require "rails_helper"

RSpec.describe "Master::AdvisoryOverrideReasons", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  it "lists reasons in display order and filters enabled ones" do
    Master::AdvisoryOverrideReason.create!(code: "other", name: "その他", display_order: 80)
    Master::AdvisoryOverrideReason.create!(code: "monitored", name: "モニタリング", display_order: 50, enabled: false)
    Master::AdvisoryOverrideReason.create!(code: "already-addressed", name: "対応済み", display_order: 10)

    with_admin_token(nil) { get "/master/advisory_override_reasons" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["items"].map { |i| i["code"] }).to eq(%w[already-addressed monitored other])

    with_admin_token(nil) { get "/master/advisory_override_reasons", params: { enabled: "true" } }
    expect(response.parsed_body["items"].map { |i| i["code"] }).to eq(%w[already-addressed other])
  end

  it "creates, updates by code and rejects a duplicate code" do
    with_admin_token(nil) { post "/master/advisory_override_reasons", params: { code: "patient-informed", name: "患者に説明済み" }, as: :json }
    expect(response).to have_http_status(:created)

    with_admin_token(nil) { patch "/master/advisory_override_reasons/patient-informed", params: { enabled: false }, as: :json }
    expect(response).to have_http_status(:ok)
    expect(Master::AdvisoryOverrideReason.find_by(code: "patient-informed").enabled).to be(false)

    with_admin_token(nil) { post "/master/advisory_override_reasons", params: { code: "patient-informed", name: "重複" }, as: :json }
    expect(response).to have_http_status(:unprocessable_content)

    with_admin_token(nil) { post "/master/advisory_override_reasons", params: { code: "Bad Code", name: "x" }, as: :json }
    expect(response).to have_http_status(:unprocessable_content)
  end
end
