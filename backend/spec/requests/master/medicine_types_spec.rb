require "rails_helper"

RSpec.describe "Master::MedicineTypes", type: :request do
  def valid_attrs(overrides = {})
    { code: "2171", name: "冠血管拡張剤" }.merge(overrides)
  end

  describe "GET /master/medicine_types" do
    before do
      Master::MedicineType.create!(code: "2144", name: "アンジオテンシン変換酵素阻害剤")
      Master::MedicineType.create!(code: "2325", name: "Ｈ２遮断剤")
      Master::MedicineType.create!(code: "6250", name: "抗ウイルス剤")
    end

    it "code の完全一致で絞り込む" do
      get "/master/medicine_types", params: { code: "2144" }
      items = JSON.parse(response.body)["items"]
      expect(items.map { |i| i["name"] }).to eq(["アンジオテンシン変換酵素阻害剤"])
    end

    it "名称の部分一致で検索できる" do
      get "/master/medicine_types", params: { name: "変換酵素阻害" }
      items = JSON.parse(response.body)["items"]
      expect(items.map { |i| i["code"] }).to eq(["2144"])
    end

    it "名称検索は全角半角の違いを無視する" do
      get "/master/medicine_types", params: { name: "H2遮断剤" }
      items = JSON.parse(response.body)["items"]
      expect(items.map { |i| i["code"] }).to eq(["2325"])
    end
  end

  describe "GET /master/medicine_types/options" do
    it "全件を薬効分類番号順の配列で返す（プルダウン用）" do
      Master::MedicineType.create!(code: "2325", name: "Ｈ２遮断剤")
      Master::MedicineType.create!(code: "2144", name: "アンジオテンシン変換酵素阻害剤")
      Master::MedicineType.create!(code: "2171", name: "冠血管拡張剤")

      get "/master/medicine_types/options"
      body = JSON.parse(response.body)
      expect(body).to be_an(Array)
      expect(body.map { |i| i["code"] }).to eq(%w[2144 2171 2325])
      expect(body.first).to include("code" => "2144", "name" => "アンジオテンシン変換酵素阻害剤")
    end
  end

  describe "CRUD" do
    it "creates, reads, updates, and deletes a record" do
      post "/master/medicine_types", params: valid_attrs, as: :json
      expect(response).to have_http_status(:created)
      id = JSON.parse(response.body)["id"]

      get "/master/medicine_types/#{id}"
      expect(JSON.parse(response.body)["name"]).to eq("冠血管拡張剤")

      patch "/master/medicine_types/#{id}", params: { name: "更新後" }, as: :json
      expect(JSON.parse(response.body)["name"]).to eq("更新後")

      delete "/master/medicine_types/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "returns 422 for a duplicate code" do
      post "/master/medicine_types", params: valid_attrs, as: :json
      post "/master/medicine_types", params: valid_attrs, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
