require "rails_helper"

RSpec.describe "Master::DiseaseIndexes", type: :request do
  describe "POST /master/disease_indexes/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("disease_indexes_sample.txt", "text/plain")

      post "/master/disease_indexes/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(3)
      expect(Master::DiseaseIndex.count).to eq(3)
    end

    it "returns 422 when file is missing" do
      post "/master/disease_indexes/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/disease_indexes (検索)" do
    before do
      Master::DiseaseIndex.create!(term: "急性膵炎", target_code: "C142", disease_modifier_category: "1")
      Master::DiseaseIndex.create!(term: "キュウセイスイエン", target_code: "C142", disease_modifier_category: "1")
      Master::DiseaseIndex.create!(term: "急性", target_code: "0001", disease_modifier_category: "2")
    end

    def terms_for(params)
      get "/master/disease_indexes", params: params
      JSON.parse(response.body)["items"].map { |i| i["term"] }
    end

    it "索引用語の表記ゆれ(ひらがな/カタカナ)を吸収して検索できる" do
      expect(terms_for(term: "きゅうせいすいえん")).to eq(["キュウセイスイエン"])
    end

    it "target_code の完全一致で絞り込む(カンマ区切りで複数指定可)" do
      expect(terms_for(target_code: "0001")).to eq(["急性"])
      expect(terms_for(target_code: "C142,0001").size).to eq(3)
    end

    it "disease_modifier_category で絞り込む" do
      expect(terms_for(disease_modifier_category: "2")).to eq(["急性"])
    end
  end
end
