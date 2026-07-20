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

  describe "GET /master/medicine_usages (区分フィルタ)" do
    before do
      Master::MedicineUsage.create!(
        usage_code: "1011000000000000", usage_name: "内服A",
        basic_usage_category_code: "1", basic_usage_category: "内服",
        detailed_usage_category_code: "A", detailed_usage_category: "経口",
        timing_category_code: "1", timing_category: "食事ベース型"
      )
      Master::MedicineUsage.create!(
        usage_code: "2A05000000000000", usage_name: "外用B",
        basic_usage_category_code: "2", basic_usage_category: "外用",
        detailed_usage_category_code: "H", detailed_usage_category: "点眼",
        timing_category_code: "5", timing_category: "頓用指示型"
      )
    end

    it "filters by each category independently" do
      get "/master/medicine_usages", params: { basic_usage_category: "内服" }
      body = JSON.parse(response.body)
      expect(body["total"]).to eq(1)
      expect(body["items"].first["usage_name"]).to eq("内服A")

      get "/master/medicine_usages", params: { detailed_usage_category: "点眼" }
      expect(JSON.parse(response.body)["items"].map { |i| i["usage_name"] }).to eq(["外用B"])

      get "/master/medicine_usages", params: { timing_category: "食事ベース型" }
      expect(JSON.parse(response.body)["items"].map { |i| i["usage_name"] }).to eq(["内服A"])
    end

    it "filters by dose_count (usage_code の 4 桁目)" do
      get "/master/medicine_usages", params: { dose_count: "1" }
      expect(JSON.parse(response.body)["items"].map { |i| i["usage_name"] }).to eq(["内服A"])

      get "/master/medicine_usages", params: { dose_count: "5" }
      expect(JSON.parse(response.body)["items"].map { |i| i["usage_name"] }).to eq(["外用B"])
    end
  end

  describe "GET /master/medicine_usages/categories" do
    it "returns distinct category names ordered by category code" do
      Master::MedicineUsage.create!(
        usage_code: "1013000000000000", usage_name: "内服A",
        basic_usage_category_code: "2", basic_usage_category: "外用"
      )
      Master::MedicineUsage.create!(
        usage_code: "1011000000000000", usage_name: "内服B",
        basic_usage_category_code: "1", basic_usage_category: "内服"
      )

      get "/master/medicine_usages/categories"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["basic_usage_categories"]).to eq(%w[内服 外用])
      expect(body["detailed_usage_categories"]).to eq([])
      expect(body["dose_counts"]).to eq(%w[1 3])
    end
  end
end
