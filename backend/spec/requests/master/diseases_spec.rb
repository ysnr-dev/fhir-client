require "rails_helper"

RSpec.describe "Master::Diseases", type: :request do
  def valid_attrs(overrides = {})
    { management_number: "29999999", name: "テスト病名" }.merge(overrides)
  end

  describe "POST /master/diseases/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("diseases_sample.txt", "text/plain")

      post "/master/diseases/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(3)
      expect(Master::Disease.count).to eq(3)
    end

    it "returns 422 when file is missing" do
      post "/master/diseases/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/diseases (検索)" do
    before do
      Master::Disease.create!(
        management_number: "20065325", name: "急性膵炎", name_kana: "キュウセイスイエン",
        exchange_code: "C142", icd10_2013: "K859"
      )
      Master::Disease.create!(
        management_number: "20066225", name: "慢性膵炎", name_kana: "マンセイスイエン",
        exchange_code: "C143", icd10_2013: "K861"
      )
      Master::Disease.create!(
        management_number: "20054321", name: "旧病名テスト", change_category: "1"
      )
    end

    def names_for(params)
      get "/master/diseases", params: params
      JSON.parse(response.body)["items"].map { |i| i["name"] }
    end

    it "名称の表記ゆれ(ひらがな/カタカナ)を吸収して検索できる" do
      expect(names_for(name: "きゅうせいすいえん")).to eq(["急性膵炎"])
    end

    it "exchange_code の完全一致で絞り込む" do
      expect(names_for(exchange_code: "C143")).to eq(["慢性膵炎"])
    end

    it "icd10_2013 の完全一致で絞り込む" do
      expect(names_for(icd10_2013: "K859")).to eq(["急性膵炎"])
    end

    it "exclude_deleted で削除区分レコードを除外する" do
      expect(names_for(exclude_deleted: "1")).to eq(%w[急性膵炎 慢性膵炎])
    end
  end

  describe "CRUD" do
    it "creates, reads, updates, lists, and deletes a record" do
      post "/master/diseases", params: valid_attrs, as: :json
      expect(response).to have_http_status(:created)
      id = JSON.parse(response.body)["id"]

      get "/master/diseases/#{id}"
      expect(JSON.parse(response.body)["name"]).to eq("テスト病名")

      patch "/master/diseases/#{id}", params: { name: "更新後" }, as: :json
      expect(JSON.parse(response.body)["name"]).to eq("更新後")

      get "/master/diseases", params: { name: "更新後" }
      expect(JSON.parse(response.body)["total"]).to eq(1)

      delete "/master/diseases/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "returns 422 for a duplicate management_number" do
      post "/master/diseases", params: valid_attrs, as: :json
      post "/master/diseases", params: valid_attrs, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
