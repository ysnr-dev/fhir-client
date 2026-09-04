require "rails_helper"

RSpec.describe "Master::PostalCodes", type: :request do
  describe "POST /master/postal_codes/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("postal_codes_sample.csv", "text/csv")

      post "/master/postal_codes/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(5)
      expect(Master::PostalCode.count).to eq(5)
    end

    it "returns 422 when file is missing" do
      post "/master/postal_codes/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/postal_codes" do
    before do
      Master::PostalCode.create!(postal_code: "1000001", prefecture: "東京都", city: "千代田区", town: "千代田")
      Master::PostalCode.create!(postal_code: "6008216", prefecture: "京都府", city: "京都市下京区", town: "戒光寺町")
      Master::PostalCode.create!(postal_code: "6008216", prefecture: "京都府", city: "京都市下京区", town: "御方紺屋町")
    end

    def items_for(params)
      get "/master/postal_codes", params: params
      JSON.parse(response.body)["items"]
    end

    it "郵便番号で引ける" do
      expect(items_for(postal_code: "1000001").map { |i| i["town"] }).to eq(["千代田"])
    end

    it "ハイフン付きでも引ける" do
      expect(items_for(postal_code: "100-0001").map { |i| i["town"] }).to eq(["千代田"])
    end

    it "1つの郵便番号が複数の町域を表す場合はすべて返す" do
      expect(items_for(postal_code: "6008216").map { |i| i["town"] }).to contain_exactly("戒光寺町", "御方紺屋町")
    end
  end
end
