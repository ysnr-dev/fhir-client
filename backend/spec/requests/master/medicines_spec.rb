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

  describe "GET /master/medicines (表記ゆれ検索)" do
    before do
      Master::Medicine.create!(
        medicine_code: "610000001", name: "ロキソニン錠６０ｍｇ", name_kana: "ﾛｷｿﾆﾝｼﾞｮｳ60MG",
        generic_name_description: "【般】ロキソプロフェンＮａ錠６０ｍｇ"
      )
      Master::Medicine.create!(medicine_code: "610000002", name: "ＰＬ配合顆粒", name_kana: "PLﾊｲｺﾞｳｶﾘｭｳ")
      Master::Medicine.create!(medicine_code: "610000003", name: "アスピリン錠")
    end

    def names_for(query)
      get "/master/medicines", params: { name: query }
      JSON.parse(response.body)["items"].map { |i| i["name"] }
    end

    it "ひらがなでカタカナ名にヒットする" do
      expect(names_for("ろきそにん")).to eq(["ロキソニン錠６０ｍｇ"])
    end

    it "全角半角の違いを無視する" do
      expect(names_for("PL配合顆粒")).to eq(["ＰＬ配合顆粒"])
      expect(names_for("ロキソニン60mg")).to eq(["ロキソニン錠６０ｍｇ"])
    end

    it "間の語が抜けていてもトークンの AND 検索でヒットする" do
      expect(names_for("PL顆粒")).to eq(["ＰＬ配合顆粒"])
    end

    it "カナ読み(ひらがな)でもヒットする" do
      expect(names_for("はいごうかりゅう")).to eq(["ＰＬ配合顆粒"])
    end

    it "一般名称でもヒットする" do
      expect(names_for("ロキソプロフェン")).to eq(["ロキソニン錠６０ｍｇ"])
      expect(names_for("ろきそぷろふぇんna")).to eq(["ロキソニン錠６０ｍｇ"])
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
