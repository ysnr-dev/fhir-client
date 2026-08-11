require "rails_helper"

RSpec.describe "Master::SchemaCategories", type: :request do
  # バリデーションを通る最小の dataURL(中身は正しい PNG でなくてよい)
  let(:png_data_url) { "data:image/png;base64,iVBORw0KGgo=" }

  def body
    JSON.parse(response.body)
  end

  describe "GET /master/schema_categories" do
    it "表示順→idの順で全件返す" do
      Master::SchemaCategory.create!(name: "胸部", display_order: 2)
      Master::SchemaCategory.create!(name: "頭頸部", display_order: 1)
      Master::SchemaCategory.create!(name: "未設定")

      get "/master/schema_categories"

      expect(body["total"]).to eq(3)
      expect(body["items"].map { |c| c["name"] }).to eq(%w[頭頸部 胸部 未設定])
    end
  end

  describe "CRUD" do
    it "作成・更新・削除でき、display_order 未指定なら同じ親の末尾に置く" do
      root = Master::SchemaCategory.create!(name: "全身", display_order: 5)

      # 別の親の display_order には影響されず、親ごとに連番が始まる
      post "/master/schema_categories", params: { name: "頭頸部", parent_id: root.id }, as: :json
      expect(response).to have_http_status(:created)
      expect(body["display_order"]).to eq(1)
      first_child = body["id"]

      post "/master/schema_categories", params: { name: "胸部", parent_id: root.id }, as: :json
      expect(body["display_order"]).to eq(2)

      patch "/master/schema_categories/#{first_child}", params: { name: "頭部" }, as: :json
      expect(body["name"]).to eq("頭部")

      delete "/master/schema_categories/#{body["id"]}"
      expect(response).to have_http_status(:no_content)
    end

    it "自分自身や子孫を親にはできない" do
      root = Master::SchemaCategory.create!(name: "全身")
      child = Master::SchemaCategory.create!(name: "頭頸部", parent_id: root.id)

      patch "/master/schema_categories/#{root.id}", params: { parent_id: root.id }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      patch "/master/schema_categories/#{root.id}", params: { parent_id: child.id }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "子カテゴリや所属シェーマが残っていると削除できない" do
      root = Master::SchemaCategory.create!(name: "全身")
      child = Master::SchemaCategory.create!(name: "頭頸部", parent_id: root.id)

      delete "/master/schema_categories/#{root.id}"
      expect(response).to have_http_status(:unprocessable_content)

      Master::Schema.create!(name: "顔", category_id: child.id,
                             image: png_data_url, thumbnail: png_data_url)
      delete "/master/schema_categories/#{child.id}"
      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
