require "rails_helper"

RSpec.describe "Master::PharmacistInterventionTypes", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  it "lists intervention types in display order and filters enabled ones" do
    Master::PharmacistInterventionType.create!(code: "other", name: "その他", display_order: 100)
    Master::PharmacistInterventionType.create!(code: "renal", name: "腎機能", display_order: 40, enabled: false)
    Master::PharmacistInterventionType.create!(code: "dose", name: "用量", display_order: 10)

    with_admin_token(nil) { get "/master/pharmacist_intervention_types" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["items"].map { |i| i["code"] }).to eq(%w[dose renal other])

    with_admin_token(nil) { get "/master/pharmacist_intervention_types", params: { enabled: "true" } }
    expect(response.parsed_body["items"].map { |i| i["code"] }).to eq(%w[dose other])
  end

  it "creates, updates by code and rejects a duplicate code" do
    with_admin_token(nil) { post "/master/pharmacist_intervention_types", params: { code: "interaction", name: "相互作用" }, as: :json }
    expect(response).to have_http_status(:created)

    with_admin_token(nil) { patch "/master/pharmacist_intervention_types/interaction", params: { enabled: false }, as: :json }
    expect(response).to have_http_status(:ok)
    expect(Master::PharmacistInterventionType.find_by(code: "interaction").enabled).to be(false)

    with_admin_token(nil) { post "/master/pharmacist_intervention_types", params: { code: "interaction", name: "重複" }, as: :json }
    expect(response).to have_http_status(:unprocessable_content)

    with_admin_token(nil) { post "/master/pharmacist_intervention_types", params: { code: "Bad Code", name: "x" }, as: :json }
    expect(response).to have_http_status(:unprocessable_content)
  end
end
