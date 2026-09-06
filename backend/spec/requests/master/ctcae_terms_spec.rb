require "rails_helper"

RSpec.describe "Master::CtcaeTerms", type: :request do
  describe "POST /master/ctcae_terms/import" do
    it "アップロードした配布ファイルを取り込む" do
      post "/master/ctcae_terms/import", params: { file: fixture_file_upload("ctcae_terms_sample.xlsx") }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(2)
      expect(Master::CtcaeTerm.count).to eq(2)
    end

    it "ファイルが無ければ 422" do
      post "/master/ctcae_terms/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/ctcae_terms" do
    before do
      Master::CtcaeTerm.create!(
        meddra_code: "10002272", term_ja: "貧血", term_en: "Anemia",
        soc_ja: "血液およびリンパ系障害", grade1_ja: "軽度", display_order: 1
      )
      Master::CtcaeTerm.create!(
        meddra_code: "10029354", term_ja: "好中球数減少", soc_ja: "臨床検査", display_order: 2
      )
    end

    it "用語の部分一致で引ける" do
      get "/master/ctcae_terms", params: { name: "好中球" }

      body = JSON.parse(response.body)
      expect(body["items"].map { |i| i["term_ja"] }).to eq(["好中球数減少"])
    end

    it "器官別大分類で絞れる" do
      get "/master/ctcae_terms", params: { soc: "臨床検査" }

      expect(JSON.parse(response.body)["items"].size).to eq(1)
    end

    it "MedDRA コードで引ける" do
      get "/master/ctcae_terms", params: { meddra_code: "10002272" }

      expect(JSON.parse(response.body)["items"].first["term_ja"]).to eq("貧血")
    end
  end

  describe "GET /master/ctcae_terms/socs" do
    it "収載順の器官別大分類を返す" do
      Master::CtcaeTerm.create!(meddra_code: "1", term_ja: "A", soc_ja: "臨床検査", display_order: 2)
      Master::CtcaeTerm.create!(meddra_code: "2", term_ja: "B", soc_ja: "血液およびリンパ系障害", display_order: 1)

      get "/master/ctcae_terms/socs"

      expect(JSON.parse(response.body)["items"]).to eq(["血液およびリンパ系障害", "臨床検査"])
    end
  end
end
