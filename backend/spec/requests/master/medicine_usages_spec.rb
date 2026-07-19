require "rails_helper"

RSpec.describe "Master::MedicineUsages", type: :request do
  def valid_attrs(overrides = {})
    { usage_code: "9999999999999999", usage_name: "テスト用法" }.merge(overrides)
  end

  describe "POST /master/medicine_usages/import" do
    it "imports the uploaded xlsx file" do
      file = fixture_file_upload(
        "medicine_usages_sample.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )

      post "/master/medicine_usages/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(1803)
      expect(Master::MedicineUsage.count).to eq(1803)
    end

    it "returns 422 when file is missing" do
      post "/master/medicine_usages/import", params: {}

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "CRUD" do
    it "creates, reads, updates, lists, and deletes a record" do
      post "/master/medicine_usages", params: valid_attrs, as: :json
      expect(response).to have_http_status(:created)
      id = JSON.parse(response.body)["id"]

      get "/master/medicine_usages/#{id}"
      expect(JSON.parse(response.body)["usage_name"]).to eq("テスト用法")

      patch "/master/medicine_usages/#{id}", params: { usage_name: "更新後" }, as: :json
      expect(JSON.parse(response.body)["usage_name"]).to eq("更新後")

      get "/master/medicine_usages", params: { usage_name: "更新後" }
      expect(JSON.parse(response.body)["total"]).to eq(1)

      delete "/master/medicine_usages/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "returns 422 when usage_code is missing" do
      post "/master/medicine_usages", params: { usage_name: "無効" }, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end
