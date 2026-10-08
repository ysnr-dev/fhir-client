require "rails_helper"

RSpec.describe "Master::DpcTables", type: :request do
  describe "POST /master/dpc_tables/import" do
    it "アップロードした電子点数表を取り込み、シートごとの件数を返す" do
      post "/master/dpc_tables/import", params: { file: fixture_file_upload("dpc_tables_sample.xlsx") }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["imported"]).to be_positive
      expect(body["elements"]).to include("変換テーブル" => 641)
    end

    it "ファイルが無ければ 422" do
      post "/master/dpc_tables/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "電子点数表のシートが無ければ 422" do
      post "/master/dpc_tables/import", params: { file: fixture_file_upload("ctcae_terms_sample.xlsx") }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/dpc_tables" do
    it "取り込んだ版を新しい順に返す" do
      Master::DpcEdition.create!(edition: "20240601", imported_at: Time.current)
      Master::DpcEdition.create!(edition: "20260601", imported_at: Time.current, counts: { "conversion" => 9248 })

      get "/master/dpc_tables"

      items = JSON.parse(response.body)["items"]
      expect(items.map { |i| i["edition"] }).to eq(%w[20260601 20240601])
      expect(items.first["counts"]).to eq("conversion" => 9248)
    end
  end
end
