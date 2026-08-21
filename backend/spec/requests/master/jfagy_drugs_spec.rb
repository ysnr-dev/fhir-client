require "rails_helper"

RSpec.describe "Master::JfagyDrugs", type: :request do
  describe "POST /master/jfagy_drugs/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("jfagy_drugs_sample.csv", "text/csv")

      post "/master/jfagy_drugs/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(3)
      expect(Master::JfagyDrug.count).to eq(3)
    end

    it "returns 422 when file is missing" do
      post "/master/jfagy_drugs/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/jfagy_drugs (検索)" do
    before do
      Master::JfagyDrug.create!(jfagy_code: "GCM1112700X1ZZZ", name: "ハロタン")
      Master::JfagyDrug.create!(jfagy_code: "GCM1119402A1ZZZ", name: "プロポフォール")
      Master::JfagyDrug.create!(jfagy_code: "GCM1124017B1ZZZ", name: "ジアゼパム")
    end

    def names_for(params)
      get "/master/jfagy_drugs", params: params
      JSON.parse(response.body)["items"].map { |i| i["name"] }
    end

    it "名称の表記ゆれ(ひらがな/カタカナ)を吸収して検索できる" do
      expect(names_for(name: "ぷろぽふぉーる")).to eq(["プロポフォール"])
    end

    it "jfagy_code の完全一致で絞り込む" do
      expect(names_for(jfagy_code: "GCM1112700X1ZZZ")).to eq(["ハロタン"])
    end
  end
end
