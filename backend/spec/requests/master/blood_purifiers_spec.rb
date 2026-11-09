require "rails_helper"

RSpec.describe "Master::BloodPurifiers", type: :request do
  def body
    JSON.parse(response.body)
  end

  let!(:receipt_material) do
    Master::MedicalMaterial.create!(
      material_code: "710010933", name: "ダイアライザー（２ａ型）",
      price: 1450.00, abolished_on: "99999999"
    )
  end

  describe "GET /master/blood_purifiers" do
    before do
      Master::BloodPurifier.create!(
        purifier_code: "000001", kind: "dialyzer", name: "検証ダイアライザ 15",
        name_kana: "ｹﾝｼｮｳﾀﾞｲｱﾗｲｻﾞ", maker: "検証メーカー", membrane_material: "PS", membrane_area: 1.5,
        receipt_material_code: "710010933", display_order: 1
      )
      Master::BloodPurifier.create!(
        purifier_code: "000002", kind: "plasma_separator", name: "検証血漿分離器", display_order: 2
      )
      Master::BloodPurifier.create!(
        purifier_code: "000003", kind: "dialyzer", name: "採用終了したダイアライザ",
        valid_from: FacilityClock.today - 100, valid_to: FacilityClock.today - 1, display_order: 3
      )
    end

    it "膜素材と膜面積、紐付けた特定器材の名称と価格を添えて返す" do
      get "/master/blood_purifiers"

      linked = body["items"].find { |i| i["purifier_code"] == "000001" }
      expect(linked["membrane_material"]).to eq("PS")
      expect(linked["membrane_area"]).to eq("1.5")
      expect(linked["receipt_material_name"]).to eq("ダイアライザー（２ａ型）")
      expect(linked["receipt_material_price"]).to eq("1450.0")
    end

    it "種別で絞り込める" do
      get "/master/blood_purifiers", params: { kind: "plasma_separator" }

      expect(body["items"].map { |i| i["purifier_code"] }).to eq(%w[000002])
    end

    it "unlinked=true で未紐付けの製品だけを洗い出せる" do
      get "/master/blood_purifiers", params: { unlinked: "true" }

      expect(body["items"].map { |i| i["purifier_code"] }).to eq(%w[000002 000003])
    end

    it "active=true は採用期間内の製品だけ返す" do
      get "/master/blood_purifiers", params: { active: "true" }

      expect(body["items"].map { |i| i["purifier_code"] }).to eq(%w[000001 000002])
    end

    it "製品名・カナ・メーカーで検索できる" do
      get "/master/blood_purifiers", params: { name: "けんしょうだいあ" }
      expect(body["items"].map { |i| i["purifier_code"] }).to eq(%w[000001])

      get "/master/blood_purifiers", params: { maker: "検証メーカー" }
      expect(body["items"].map { |i| i["purifier_code"] }).to eq(%w[000001])
    end
  end

  describe "GET /master/blood_purifiers/:id" do
    it "コードでも引け、紐付け先を添える" do
      Master::BloodPurifier.create!(purifier_code: "000001", kind: "dialyzer", name: "製品A",
                                    receipt_material_code: "710010933")

      get "/master/blood_purifiers/000001"

      expect(body["name"]).to eq("製品A")
      expect(body["receipt_material_name"]).to eq(receipt_material.name)
    end
  end

  describe "POST /master/blood_purifiers" do
    it "コードを省略すると自動採番する" do
      Master::BloodPurifier.create!(purifier_code: "000012", kind: "dialyzer", name: "既存")

      post "/master/blood_purifiers", params: { kind: "dialyzer", name: "自動採番の製品" }

      expect(response).to have_http_status(:created)
      expect(body["purifier_code"]).to eq("000013")
    end

    it "製品名は必須" do
      post "/master/blood_purifiers", params: { kind: "dialyzer" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "定義に無い種別は登録できない" do
      post "/master/blood_purifiers", params: { kind: "unknown", name: "製品A" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "膜面積は正の数だけ受け付ける" do
      post "/master/blood_purifiers", params: { kind: "dialyzer", name: "製品A", membrane_area: "0" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "採用終了日が採用開始日より前なら登録できない" do
      post "/master/blood_purifiers", params: { kind: "dialyzer", name: "期間おかしい",
                                                valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("採用開始日以降")
    end
  end

  describe "PATCH /master/blood_purifiers/:id" do
    it "紐付けを後から付け替えられる" do
      record = Master::BloodPurifier.create!(purifier_code: "000001", kind: "dialyzer", name: "製品A")

      patch "/master/blood_purifiers/000001", params: { receipt_material_code: "710010933" }

      expect(record.reload.receipt_material_code).to eq("710010933")
    end
  end

  describe "DELETE /master/blood_purifiers/:id" do
    it "削除できる" do
      Master::BloodPurifier.create!(purifier_code: "000001", kind: "dialyzer", name: "製品A")

      delete "/master/blood_purifiers/000001"

      expect(response).to have_http_status(:no_content)
      expect(Master::BloodPurifier.count).to eq(0)
    end
  end
end
