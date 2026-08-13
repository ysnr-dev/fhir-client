require "rails_helper"

RSpec.describe "Master::RadMaterials", type: :request do
  def body
    JSON.parse(response.body)
  end

  # 算定に使う配布マスタ側(レセプト電算の特定器材)。概念的な名称で収載されている。
  let!(:receipt_material) do
    Master::MedicalMaterial.create!(
      material_code: "710010004", name: "中心静脈用カテーテル（標準・シングルルーメン）",
      price: 1790.00, abolished_on: "99999999"
    )
  end

  describe "GET /master/rad_materials" do
    before do
      Master::RadMaterial.create!(
        material_code: "000001", name: "アロー中心静脈カテーテルキット CS-12703",
        name_kana: "ｱﾛｰﾁｭｳｼﾝｼﾞｮｳﾐｬｸｶﾃｰﾃﾙｷｯﾄ", maker: "テレフレックス", model_number: "CS-12703-E",
        receipt_material_code: "710010004", unit_name: "本", display_order: 1
      )
      Master::RadMaterial.create!(
        material_code: "000002", name: "未紐付けの器材", maker: "サンプル社", display_order: 2
      )
      Master::RadMaterial.create!(
        material_code: "000003", name: "採用終了した器材",
        valid_from: Date.current - 100, valid_to: Date.current - 1, display_order: 3
      )
    end

    it "紐付けたレセプト電算の特定器材の名称と価格を添えて返す" do
      get "/master/rad_materials"

      linked = body["items"].find { |i| i["material_code"] == "000001" }
      expect(linked["name"]).to eq("アロー中心静脈カテーテルキット CS-12703")
      expect(linked["receipt_material_code"]).to eq("710010004")
      expect(linked["receipt_material_name"]).to eq("中心静脈用カテーテル（標準・シングルルーメン）")
      expect(linked["receipt_material_price"]).to eq("1790.0")
    end

    it "未紐付けの器材も一覧に出る(紐付け先は空)" do
      get "/master/rad_materials"

      unlinked = body["items"].find { |i| i["material_code"] == "000002" }
      expect(unlinked["receipt_material_name"]).to be_nil
    end

    it "unlinked=true で未紐付けの器材だけを洗い出せる" do
      get "/master/rad_materials", params: { unlinked: "true" }

      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[000002 000003])
    end

    it "レセプト電算の特定器材コードで絞り込める" do
      get "/master/rad_materials", params: { receipt_material_code: "710010004" }

      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[000001])
    end

    it "active=true は採用期間内の器材だけ返す" do
      get "/master/rad_materials", params: { active: "true" }

      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[000001 000002])
    end

    it "製品名・カナ・メーカーで検索できる" do
      get "/master/rad_materials", params: { name: "あろー" }
      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[000001])

      get "/master/rad_materials", params: { maker: "テレフレックス" }
      expect(body["items"].map { |i| i["material_code"] }).to eq(%w[000001])
    end
  end

  describe "GET /master/rad_materials/:id" do
    it "器材コードでも引け、紐付け先を添える" do
      Master::RadMaterial.create!(material_code: "000001", name: "製品A",
                                  receipt_material_code: "710010004")

      get "/master/rad_materials/000001"

      expect(body["name"]).to eq("製品A")
      expect(body["receipt_material_name"]).to eq(receipt_material.name)
    end
  end

  describe "POST /master/rad_materials" do
    it "製品を登録してレセプト電算の特定器材コードを紐付ける" do
      post "/master/rad_materials", params: {
        name: "ラジフォーカスガイドワイヤー M", maker: "テルモ", model_number: "RF-GA35153M",
        receipt_material_code: "710010004", unit_name: "本"
      }

      expect(response).to have_http_status(:created)
      expect(body["receipt_material_code"]).to eq("710010004")
    end

    it "器材コードを省略すると自動採番する" do
      Master::RadMaterial.create!(material_code: "000012", name: "既存")

      post "/master/rad_materials", params: { name: "自動採番の器材" }

      expect(body["material_code"]).to eq("000013")
    end

    it "製品名は必須" do
      post "/master/rad_materials", params: { maker: "メーカーだけ" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "採用終了日が採用開始日より前なら登録できない" do
      post "/master/rad_materials", params: { name: "期間おかしい",
                                              valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("採用開始日以降")
    end

    it "紐付け先が未取込でも登録できる(配布マスタの取込順に縛られない)" do
      post "/master/rad_materials", params: { name: "先に登録する器材",
                                              receipt_material_code: "999999999" }

      expect(response).to have_http_status(:created)
    end
  end

  describe "PATCH /master/rad_materials/:id" do
    it "紐付けを後から付け替えられる" do
      record = Master::RadMaterial.create!(material_code: "000001", name: "製品A")

      patch "/master/rad_materials/000001", params: { receipt_material_code: "710010004" }

      expect(record.reload.receipt_material_code).to eq("710010004")
      expect(record.receipt_material.name).to eq(receipt_material.name)
    end
  end

  describe "DELETE /master/rad_materials/:id" do
    it "削除できる" do
      Master::RadMaterial.create!(material_code: "000001", name: "製品A")

      delete "/master/rad_materials/000001"

      expect(response).to have_http_status(:no_content)
      expect(Master::RadMaterial.count).to eq(0)
    end
  end
end
