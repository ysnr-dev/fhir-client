require "rails_helper"

RSpec.describe "Master::RadDatasets", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/rad_datasets" do
    before do
      Master::RadDataset.create!(dataset_code: "000001", name: "造影CT標準セット",
                                 name_kana: "ｿﾞｳｴｲｼｰﾃｨｰﾋｮｳｼﾞｭﾝｾｯﾄ", display_order: 1)
      Master::RadDataset.create!(dataset_code: "000002", name: "血管撮影セット", display_order: 2)
      Master::RadDataset.create!(dataset_code: "000003", name: "運用終了セット", display_order: 3,
                                 valid_from: Date.current - 100, valid_to: Date.current - 1)
    end

    it "表示順で一覧を返す" do
      get "/master/rad_datasets"

      expect(body["items"].map { |i| i["dataset_code"] }).to eq(%w[000001 000002 000003])
    end

    it "active=true は運用期間内のデータセットだけ返す" do
      get "/master/rad_datasets", params: { active: "true" }

      expect(body["items"].map { |i| i["dataset_code"] }).to eq(%w[000001 000002])
    end

    it "データセットコードをカンマ区切りで複数指定できる" do
      get "/master/rad_datasets", params: { dataset_code: "000001,000003" }

      expect(body["items"].map { |i| i["dataset_code"] }).to eq(%w[000001 000003])
    end

    it "名称・カナで検索できる" do
      get "/master/rad_datasets", params: { name: "ぞうえい" }

      expect(body["items"].map { |i| i["dataset_code"] }).to eq(%w[000001])
    end
  end

  describe "GET /master/rad_datasets/:id" do
    let!(:dataset) { Master::RadDataset.create!(dataset_code: "000001", name: "造影CT標準セット") }

    before do
      Master::MedicalProcedure.create!(procedure_code: "170000410", name: "ＣＴ撮影（マルチスライス型）",
                                       points: 1000, abolished_on: "99999999")
      Master::Medicine.create!(medicine_code: "622222901", name: "オムニパーク３００注シリンジ１００ｍＬ",
                               unit_name: "筒")
      Master::RadMaterial.create!(material_code: "000001", name: "延長チューブ", unit_name: "本",
                                  receipt_material_code: "710010004")

      Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "procedure",
                                       code: "170000410", display_order: 1)
      Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                       code: "622222901", default_quantity: 100, route_code: "IV",
                                       display_order: 2)
      Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "material",
                                       code: "000001", default_quantity: 1, display_order: 3)
      # 別データセットの明細は混ざらない。
      Master::RadDatasetDetail.create!(dataset_code: "000002", detail_type: "procedure",
                                       code: "170000410")
    end

    it "データセットコードでも引け、明細に参照先マスタの名称を添える" do
      get "/master/rad_datasets/000001"

      expect(body["name"]).to eq("造影CT標準セット")
      details = body["details"]
      expect(details.map { |d| d["detail_type"] }).to eq(%w[procedure medicine material])
      expect(details.map { |d| d["resolved_name"] }).to eq(
        ["ＣＴ撮影（マルチスライス型）", "オムニパーク３００注シリンジ１００ｍＬ", "延長チューブ"]
      )
      expect(details[1]["resolved_unit_name"]).to eq("筒")
      expect(details[1]["route_code"]).to eq("IV")
      expect(details[2]["receipt_material_code"]).to eq("710010004")
    end

    it "id でも引ける" do
      get "/master/rad_datasets/#{dataset.id}"

      expect(body["dataset_code"]).to eq("000001")
    end
  end

  describe "POST /master/rad_datasets" do
    it "データセットコードを省略すると自動採番する" do
      Master::RadDataset.create!(dataset_code: "000012", name: "既存")

      post "/master/rad_datasets", params: { name: "自動採番のセット" }

      expect(response).to have_http_status(:created)
      expect(body["dataset_code"]).to eq("000013")
    end

    it "名称は必須" do
      post "/master/rad_datasets", params: { note: "名称なし" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "運用終了日が運用開始日より前なら登録できない" do
      post "/master/rad_datasets", params: { name: "期間おかしい",
                                             valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("運用開始日以降")
    end
  end

  describe "DELETE /master/rad_datasets/:id" do
    it "明細と撮影項目への紐付けも併せて片付ける" do
      Master::RadDataset.create!(dataset_code: "000001", name: "造影CT標準セット")
      Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "procedure", code: "170000410")
      Master::RadItemDataset.create!(item_code: "000100", dataset_code: "000001")
      # 別データセットのものは残る。
      Master::RadDatasetDetail.create!(dataset_code: "000002", detail_type: "procedure", code: "170000410")

      delete "/master/rad_datasets/000001"

      expect(response).to have_http_status(:no_content)
      expect(Master::RadDatasetDetail.where(dataset_code: "000001").count).to eq(0)
      expect(Master::RadItemDataset.count).to eq(0)
      expect(Master::RadDatasetDetail.where(dataset_code: "000002").count).to eq(1)
    end
  end
end
