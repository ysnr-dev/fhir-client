require "rails_helper"

RSpec.describe "Master::MicroCollectionSites", type: :request do
  def body
    JSON.parse(response.body)
  end

  it "掲載順で返す" do
    Master::MicroCollectionSite.create!(code: "04", name: "耳", laterality_applicable: true,
                                        display_order: 40)
    Master::MicroCollectionSite.create!(code: "01", name: "咽頭", display_order: 10)

    get "/master/micro_collection_sites"

    expect(body["items"].map { |i| i["code"] }).to eq(%w[01 04])
    expect(body["items"][1]["laterality_applicable"]).to be(true)
  end

  it "作成・更新・削除できる(部位コードは変更不可)" do
    post "/master/micro_collection_sites",
         params: { code: "20", name: "外耳道", laterality_applicable: true }, as: :json
    expect(response).to have_http_status(:created)
    id = body["id"]

    patch "/master/micro_collection_sites/#{id}", params: { code: "21", name: "外耳" }, as: :json
    expect(Master::MicroCollectionSite.find(id)).to have_attributes(code: "20", name: "外耳")

    delete "/master/micro_collection_sites/#{id}"
    expect(response).to have_http_status(:no_content)
  end
end
