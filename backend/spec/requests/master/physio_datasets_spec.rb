require "rails_helper"

RSpec.describe "Master::PhysioDatasets", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/physio_datasets" do
    before do
      Master::PhysioDataset.create!(dataset_code: "000001", name: "負荷心電図標準セット",
                                    name_kana: "ﾌｶｼﾝﾃﾞﾝｽﾞﾋｮｳｼﾞｭﾝｾｯﾄ", display_order: 1)
      Master::PhysioDataset.create!(dataset_code: "000002", name: "気道可逆性試験セット", display_order: 2)
      Master::PhysioDataset.create!(dataset_code: "000003", name: "運用終了セット", display_order: 3,
                                    valid_from: Date.current - 100, valid_to: Date.current - 1)
    end

    it "表示順で一覧を返す" do
      get "/master/physio_datasets"

      expect(body["items"].map { |i| i["dataset_code"] }).to eq(%w[000001 000002 000003])
    end

    it "active=true は運用期間内のデータセットだけ返す" do
      get "/master/physio_datasets", params: { active: "true" }

      expect(body["items"].map { |i| i["dataset_code"] }).to eq(%w[000001 000002])
    end

    it "データセットコードをカンマ区切りで複数指定できる" do
      get "/master/physio_datasets", params: { dataset_code: "000001,000003" }

      expect(body["items"].map { |i| i["dataset_code"] }).to eq(%w[000001 000003])
    end

    it "名称・カナで検索できる" do
      get "/master/physio_datasets", params: { name: "ふか" }

      expect(body["items"].map { |i| i["dataset_code"] }).to eq(%w[000001])
    end
  end

  describe "GET /master/physio_datasets/:id" do
    let!(:dataset) { Master::PhysioDataset.create!(dataset_code: "000001", name: "負荷心電図標準セット") }

    before do
      Master::MedicalProcedure.create!(procedure_code: "160067510", name: "負荷心電図検査",
                                       points: 380, abolished_on: "99999999")
      Master::Medicine.create!(medicine_code: "620000237", name: "生理食塩液　１．３Ｌ", unit_name: "袋")
      Master::MedicalMaterial.create!(material_code: "710010004", name: "延長チューブ", unit_name: "本")

      Master::PhysioDatasetDetail.create!(dataset_code: "000001", detail_type: "procedure",
                                          code: "160067510", display_order: 1)
      Master::PhysioDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                          code: "620000237", default_quantity: 1, route_code: "IV",
                                          display_order: 2)
      Master::PhysioDatasetDetail.create!(dataset_code: "000001", detail_type: "material",
                                          code: "710010004", default_quantity: 1, display_order: 3)
      # 別データセットの明細は混ざらない。
      Master::PhysioDatasetDetail.create!(dataset_code: "000002", detail_type: "procedure",
                                          code: "160067510")
    end

    it "データセットコードでも引け、明細に参照先マスタの名称を添える" do
      get "/master/physio_datasets/000001"

      expect(body["name"]).to eq("負荷心電図標準セット")
      details = body["details"]
      expect(details.map { |d| d["detail_type"] }).to eq(%w[procedure medicine material])
      expect(details.map { |d| d["resolved_name"] }).to eq(
        ["負荷心電図検査", "生理食塩液　１．３Ｌ", "延長チューブ"]
      )
      expect(details[1]["resolved_unit_name"]).to eq("袋")
      expect(details[1]["route_code"]).to eq("IV")
      # 器材は特定保険医療材料そのものを指すので、算定用コードを別に持たない。
      expect(details[2]["code"]).to eq("710010004")
      expect(details[2]).not_to have_key("receipt_material_code")
    end

    it "id でも引ける" do
      get "/master/physio_datasets/#{dataset.id}"

      expect(body["dataset_code"]).to eq("000001")
    end
  end

  describe "POST /master/physio_datasets" do
    it "データセットコードを省略すると自動採番する" do
      Master::PhysioDataset.create!(dataset_code: "000012", name: "既存")

      post "/master/physio_datasets", params: { name: "自動採番のセット" }

      expect(response).to have_http_status(:created)
      expect(body["dataset_code"]).to eq("000013")
    end

    it "名称は必須" do
      post "/master/physio_datasets", params: { note: "名称なし" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "運用終了日が運用開始日より前なら登録できない" do
      post "/master/physio_datasets", params: { name: "期間おかしい",
                                                valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("運用開始日以降")
    end
  end

  describe "DELETE /master/physio_datasets/:id" do
    it "明細と検査項目からの参照も併せて片付ける" do
      Master::PhysioDataset.create!(dataset_code: "000001", name: "負荷心電図標準セット")
      Master::PhysioDatasetDetail.create!(dataset_code: "000001", detail_type: "procedure",
                                          code: "160067510")
      item = Master::PhysioItem.create!(item_code: "000100", name: "負荷心電図", dataset_code: "000001")
      # 別データセットのものは残る。
      Master::PhysioDatasetDetail.create!(dataset_code: "000002", detail_type: "procedure",
                                          code: "160067510")

      delete "/master/physio_datasets/000001"

      expect(response).to have_http_status(:no_content)
      expect(Master::PhysioDatasetDetail.where(dataset_code: "000001").count).to eq(0)
      expect(item.reload.dataset_code).to be_nil
      expect(Master::PhysioDatasetDetail.where(dataset_code: "000002").count).to eq(1)
    end
  end
end
