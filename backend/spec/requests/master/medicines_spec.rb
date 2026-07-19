require "rails_helper"

RSpec.describe "Master::Medicines", type: :request do
  def valid_attrs(overrides = {})
    { medicine_code: "999999999", name: "テスト医薬品" }.merge(overrides)
  end

  describe "POST /master/medicines/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("medicines_sample.csv", "text/csv")

      post "/master/medicines/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(3)
      expect(Master::Medicine.count).to eq(3)
    end

    it "returns 422 when file is missing" do
      post "/master/medicines/import", params: {}

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "CRUD" do
    it "creates, reads, updates, lists, and deletes a record" do
      post "/master/medicines", params: valid_attrs, as: :json
      expect(response).to have_http_status(:created)
      id = JSON.parse(response.body)["id"]

      get "/master/medicines/#{id}"
      expect(JSON.parse(response.body)["name"]).to eq("テスト医薬品")

      patch "/master/medicines/#{id}", params: { name: "更新後" }, as: :json
      expect(JSON.parse(response.body)["name"]).to eq("更新後")

      get "/master/medicines", params: { name: "更新後" }
      expect(JSON.parse(response.body)["total"]).to eq(1)

      delete "/master/medicines/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "returns 422 when medicine_code is missing" do
      post "/master/medicines", params: { name: "無効" }, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "returns 422 for a duplicate medicine_code" do
      post "/master/medicines", params: valid_attrs, as: :json
      post "/master/medicines", params: valid_attrs, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end
