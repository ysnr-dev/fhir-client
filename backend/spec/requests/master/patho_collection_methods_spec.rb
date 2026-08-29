require "rails_helper"

RSpec.describe "Master::PathoCollectionMethods", type: :request do
  def body
    JSON.parse(response.body)
  end

  it "掲載順で返す" do
    Master::PathoCollectionMethod.create!(code: "226", name: "EMR", display_order: 260)
    Master::PathoCollectionMethod.create!(code: "101", name: "擦過", display_order: 10)

    get "/master/patho_collection_methods"

    expect(body["items"].map { |i| i["code"] }).to eq(%w[101 226])
  end

  it "作成・更新・削除できる(採取法コードは変更不可)" do
    post "/master/patho_collection_methods",
         params: { code: "281", name: "リンパ節生検", display_order: 280 }, as: :json
    expect(response).to have_http_status(:created)
    id = body["id"]

    patch "/master/patho_collection_methods/#{id}",
          params: { code: "282", name: "センチネルリンパ節生検" }, as: :json
    expect(Master::PathoCollectionMethod.find(id))
      .to have_attributes(code: "281", name: "センチネルリンパ節生検")

    delete "/master/patho_collection_methods/#{id}"
    expect(response).to have_http_status(:no_content)
  end
end
