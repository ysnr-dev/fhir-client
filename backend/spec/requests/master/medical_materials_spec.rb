require "rails_helper"

RSpec.describe "Master::MedicalMaterials", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "POST /master/medical_materials/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("medical_materials_sample.csv", "text/csv")

      post "/master/medical_materials/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(body["imported"]).to eq(4)
      expect(Master::MedicalMaterial.count).to eq(4)
    end

    it "returns 422 when file is missing" do
      post "/master/medical_materials/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/medical_materials" do
    before do
      Master::MedicalMaterial.create!(
        material_code: "710010004", name: "中心静脈用カテーテル（標準・シングルルーメン）",
        name_kana: "ﾁｭｳｼﾝｼﾞｮｳﾐｬｸﾖｳｶﾃｰﾃﾙ", material_category: "0",
        publication_order: "118000", abolished_on: "99999999"
      )
      Master::MedicalMaterial.create!(
        material_code: "700010000", name: "半切", name_kana: "ﾊﾝｾﾂ", material_category: "1",
        publication_order: "982000", abolished_on: "99999999"
      )
      Master::MedicalMaterial.create!(
        material_code: "700099999", name: "廃止された器材",
        publication_order: "999000", abolished_on: "20250331"
      )
    end

    it "公表順序番号の順で返す" do
      get "/master/medical_materials"

      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[710010004 700010000 700099999])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/medical_materials", params: { material_code: "700010000,700099999" }

      expect(body["items"].map { |i| i["material_code"] }).to match_array(%w[700010000 700099999])
    end

    it "active=true は廃止されていない器材だけ返す" do
      get "/master/medical_materials", params: { active: "true" }

      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[710010004 700010000])
    end

    it "特定器材種別で絞り込める" do
      get "/master/medical_materials", params: { material_category: "1" }

      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[700010000])
    end

    it "カナ読み(ひらがな)でヒットする" do
      get "/master/medical_materials", params: { name: "かてーてる" }

      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[710010004])
    end

    it "空白区切りの語をすべて含むもので絞り込む" do
      get "/master/medical_materials", params: { name: "中心静脈 シングルルーメン" }
      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[710010004])

      # 片方しか含まない器材は落ちる(AND 検索)。
      get "/master/medical_materials", params: { name: "中心静脈 半切" }
      expect(body["items"]).to be_empty
    end
  end
end
