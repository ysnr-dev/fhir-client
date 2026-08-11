require "rails_helper"

RSpec.describe "Master::MicroCollectionMethods", type: :request do
  def body
    JSON.parse(response.body)
  end

  it "掲載順で返す" do
    Master::MicroCollectionMethod.create!(code: "02", name: "穿刺", display_order: 20)
    Master::MicroCollectionMethod.create!(code: "01", name: "スワブ（綿棒）", display_order: 10)

    get "/master/micro_collection_methods"

    expect(body["items"].map { |i| i["code"] }).to eq(%w[01 02])
  end

  it "作成・更新・削除できる(方法コードは変更不可)" do
    post "/master/micro_collection_methods", params: { code: "20", name: "擦過" }, as: :json
    expect(response).to have_http_status(:created)
    id = body["id"]

    patch "/master/micro_collection_methods/#{id}", params: { code: "21", name: "擦過採取" }, as: :json
    expect(Master::MicroCollectionMethod.find(id)).to have_attributes(code: "20", name: "擦過採取")

    delete "/master/micro_collection_methods/#{id}"
    expect(response).to have_http_status(:no_content)
  end
end
