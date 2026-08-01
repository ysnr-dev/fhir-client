require "rails_helper"

RSpec.describe "Master::JfagyAllergens", type: :request do
  describe "POST /master/jfagy_allergens/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("jfagy_allergens_sample.csv", "text/csv")

      post "/master/jfagy_allergens/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(3)
      expect(Master::JfagyAllergen.count).to eq(3)
    end

    it "returns 422 when file is missing" do
      post "/master/jfagy_allergens/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/jfagy_allergens (検索)" do
    before do
      Master::JfagyAllergen.create!(jfagy_code: "00F", name: "食品", name_kana: "しょくひん", level: "1", main_flag: "1")
      Master::JfagyAllergen.create!(jfagy_code: "J9FA15000000", name: "小麦", name_kana: "こむぎ", level: "3", main_flag: "1")
      Master::JfagyAllergen.create!(jfagy_code: "J9FA16000000", name: "ソバ", name_kana: "そば", level: "3")
      Master::JfagyAllergen.create!(jfagy_code: "J9NK11000000", name: "スギ花粉", name_kana: "すぎかふん", level: "3")
    end

    def names_for(params)
      get "/master/jfagy_allergens", params: params
      JSON.parse(response.body)["items"].map { |i| i["name"] }
    end

    it "名称・カナの表記ゆれ(ひらがな/カタカナ)を吸収して検索できる" do
      expect(names_for(name: "こむぎ")).to eq(["小麦"])
      expect(names_for(name: "そば")).to eq(["ソバ"])
    end

    it "jfagy_code の完全一致で絞り込む" do
      expect(names_for(jfagy_code: "00F")).to eq(["食品"])
    end

    it "level で絞り込む" do
      expect(names_for(level: "3").size).to eq(3)
    end

    it "domain(メタコード3桁目の領域)で絞り込む" do
      expect(names_for(domain: "F")).to contain_exactly("食品", "小麦", "ソバ")
      expect(names_for(domain: "N")).to eq(["スギ花粉"])
    end

    it "code_prefix(階層プレフィックス)で絞り込む" do
      expect(names_for(code_prefix: "J9FA")).to contain_exactly("小麦", "ソバ")
    end

    it "main_only で主要品目(MAINFLAG=1)のみに絞る" do
      expect(names_for(main_only: "1")).to contain_exactly("食品", "小麦")
    end
  end
end
