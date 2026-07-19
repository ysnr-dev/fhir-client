require "rails_helper"

RSpec.describe "Master::HotCodes", type: :request do
  def valid_attrs(overrides = {})
    { hot_code: "999999999", hot7_code: "9999999", sales_name: "テスト薬" }.merge(overrides)
  end

  describe "POST /master/hot_codes/import" do
    it "imports the uploaded file and replaces existing data" do
      file = fixture_file_upload("hot_code_sample.txt", "text/plain")

      post "/master/hot_codes/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(3)
      expect(Master::HotCode.count).to eq(3)
    end

    it "returns 422 when file is missing" do
      post "/master/hot_codes/import", params: {}

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "CRUD" do
    it "creates, reads, updates, lists, and deletes a record" do
      post "/master/hot_codes", params: valid_attrs, as: :json
      expect(response).to have_http_status(:created)
      id = JSON.parse(response.body)["id"]

      get "/master/hot_codes/#{id}"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["sales_name"]).to eq("テスト薬")

      patch "/master/hot_codes/#{id}", params: { sales_name: "更新済み" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["sales_name"]).to eq("更新済み")

      get "/master/hot_codes", params: { sales_name: "更新済み" }
      body = JSON.parse(response.body)
      expect(body["total"]).to eq(1)
      expect(body["items"].size).to eq(1)

      delete "/master/hot_codes/#{id}"
      expect(response).to have_http_status(:no_content)

      get "/master/hot_codes/#{id}"
      expect(response).to have_http_status(:not_found)
    end

    it "returns 422 when hot_code is missing" do
      post "/master/hot_codes", params: { sales_name: "無効" }, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end
