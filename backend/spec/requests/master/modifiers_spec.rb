require "rails_helper"

RSpec.describe "Master::Modifiers", type: :request do
  describe "POST /master/modifiers/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("modifiers_sample.txt", "text/plain")

      post "/master/modifiers/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(3)
      expect(Master::Modifier.count).to eq(3)
    end

    it "returns 422 when file is missing" do
      post "/master/modifiers/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/modifiers (検索)" do
    before do
      Master::Modifier.create!(
        management_number: "27000001", name: "急性", name_kana: "キュウセイ",
        exchange_code: "0001", modifier_category: "A4100000"
      )
      Master::Modifier.create!(
        management_number: "27000003", name: "左", name_kana: "ヒダリ",
        exchange_code: "0003", modifier_category: "A2000000"
      )
    end

    def names_for(params)
      get "/master/modifiers", params: params
      JSON.parse(response.body)["items"].map { |i| i["name"] }
    end

    it "名称の表記ゆれ(ひらがな/カタカナ)を吸収して検索できる" do
      expect(names_for(name: "きゅうせい")).to eq(["急性"])
    end

    it "exchange_code の完全一致で絞り込む" do
      expect(names_for(exchange_code: "0003")).to eq(["左"])
    end

    it "modifier_category の完全一致で絞り込む" do
      expect(names_for(modifier_category: "A2000000")).to eq(["左"])
    end

    it "病名索引の同義語からも検索できる" do
      Master::DiseaseIndex.create!(term: "アキュート", target_code: "0001", disease_modifier_category: "2")

      expect(names_for(name: "あきゅーと")).to eq(["急性"])
    end

    it "exclude_deleted で削除区分レコードを除外する" do
      Master::Modifier.create!(management_number: "27009999", name: "旧修飾語", change_category: "1")

      expect(names_for(exclude_deleted: "1")).to eq(%w[急性 左])
    end
  end

  describe "CRUD" do
    it "creates and deletes a record" do
      post "/master/modifiers", params: { management_number: "29999999", name: "テスト修飾語" }, as: :json
      expect(response).to have_http_status(:created)
      id = JSON.parse(response.body)["id"]

      delete "/master/modifiers/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "returns 422 when name is missing" do
      post "/master/modifiers", params: { management_number: "29999999" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
