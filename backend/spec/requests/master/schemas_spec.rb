require "rails_helper"

RSpec.describe "Master::Schemas", type: :request do
  let(:png_data_url) { "data:image/png;base64,iVBORw0KGgo=" }

  def body
    JSON.parse(response.body)
  end

  describe "GET /master/schemas" do
    before do
      @category = Master::SchemaCategory.create!(name: "頭頸部")
      Master::Schema.create!(name: "顔", category_id: @category.id, display_order: 2,
                             image: png_data_url, thumbnail: png_data_url)
      Master::Schema.create!(name: "眼球", category_id: @category.id, display_order: 1,
                             image: png_data_url, thumbnail: png_data_url)
      Master::Schema.create!(name: "全身図",
                             image: png_data_url, thumbnail: png_data_url)
    end

    it "表示順で返し、一覧には image を含めない(thumbnail は含む)" do
      get "/master/schemas"

      expect(body["items"].map { |s| s["name"] }).to eq(%w[眼球 顔 全身図])
      expect(body["items"].first).not_to have_key("image")
      expect(body["items"].first["thumbnail"]).to eq(png_data_url)
    end

    it "カテゴリ・名称で絞り込め、category_id が空なら未分類を返す" do
      get "/master/schemas", params: { category_id: @category.id }
      expect(body["items"].map { |s| s["name"] }).to eq(%w[眼球 顔])

      get "/master/schemas", params: { category_id: "" }
      expect(body["items"].map { |s| s["name"] }).to eq(%w[全身図])

      get "/master/schemas", params: { name: "眼" }
      expect(body["items"].map { |s| s["name"] }).to eq(%w[眼球])
    end
  end

  describe "CRUD" do
    it "作成・更新・削除でき、show では image を返す" do
      post "/master/schemas", params: {
        name: "胸部", image: png_data_url, thumbnail: png_data_url,
      }, as: :json
      expect(response).to have_http_status(:created)
      expect(body["display_order"]).to eq(1)
      id = body["id"]

      get "/master/schemas/#{id}"
      expect(body["image"]).to eq(png_data_url)

      patch "/master/schemas/#{id}", params: { note: "描き込み用" }, as: :json
      expect(body["note"]).to eq("描き込み用")

      delete "/master/schemas/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "dataURL 形式でない画像は登録できない" do
      post "/master/schemas", params: {
        name: "不正", image: "https://example.com/a.png", thumbnail: png_data_url,
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
