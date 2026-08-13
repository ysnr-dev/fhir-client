require "rails_helper"

RSpec.describe "Master::MedicalProcedures", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "POST /master/medical_procedures/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("medical_procedures_sample.csv", "text/csv")

      post "/master/medical_procedures/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(body["imported"]).to eq(4)
      expect(Master::MedicalProcedure.count).to eq(4)
    end

    it "returns 422 when file is missing" do
      post "/master/medical_procedures/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/medical_procedures" do
    before do
      Master::MedicalProcedure.create!(
        procedure_code: "170000410", name: "単純撮影（イ）の写真診断",
        name_kana: "ﾀﾝｼﾞｭﾝｻﾂｴｲﾉｼｬｼﾝｼﾝﾀﾞﾝ", code_table_number_alpha: "E",
        points: 85.00, publication_order: "052330000", abolished_on: "99999999"
      )
      Master::MedicalProcedure.create!(
        procedure_code: "111000110", name: "初診料", name_kana: "ｼｮｼﾝﾘｮｳ",
        code_table_number_alpha: "A", points: 291.00,
        publication_order: "000230000", abolished_on: "99999999"
      )
      Master::MedicalProcedure.create!(
        procedure_code: "170099999", name: "廃止された撮影", code_table_number_alpha: "E",
        publication_order: "999000000", abolished_on: "20250331"
      )
    end

    it "公表順序番号の順で返す" do
      get "/master/medical_procedures"

      expect(body["items"].map { |i| i["procedure_code"] }).to eq(%w[111000110 170000410 170099999])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/medical_procedures", params: { procedure_code: "170000410,111000110" }

      expect(body["items"].map { |i| i["procedure_code"] }).to match_array(%w[170000410 111000110])
    end

    it "active=true は廃止されていない診療行為だけ返す" do
      get "/master/medical_procedures", params: { active: "true" }

      expect(body["items"].map { |i| i["procedure_code"] }).to eq(%w[111000110 170000410])
    end

    it "コード表用番号のアルファベット部(点数表の章)で絞り込める" do
      get "/master/medical_procedures", params: { code_table_number_alpha: "E", active: "true" }

      expect(body["items"].map { |i| i["procedure_code"] }).to eq(%w[170000410])
    end

    it "カナ読み(ひらがな)でヒットする" do
      get "/master/medical_procedures", params: { name: "たんじゅんさつえい" }

      expect(body["items"].map { |i| i["procedure_code"] }).to eq(%w[170000410])
    end
  end
end
