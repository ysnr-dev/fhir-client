require "rails_helper"

RSpec.describe "Master::TreatmentItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_item(code, overrides = {})
    Master::TreatmentItem.create!({ item_code: code, name: "項目#{code}" }.merge(overrides))
  end

  describe "GET /master/treatment_items" do
    before do
      create_item("T0001", name: "創傷処置(100cm2未満)", short_name: "創処置", name_kana: "ソウショウショチ",
                  display_order: 20)
      create_item("T0002", name: "褥瘡処置セット", kind: "set", display_order: 10)
      create_item("T0003", name: "旧項目", valid_to: Date.current - 1, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/treatment_items"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[T0002 T0001 T0003])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/treatment_items", params: { item_code: "T0001,T0003" }
      expect(body["items"].map { |i| i["item_code"] }).to match_array(%w[T0001 T0003])
    end

    it "kind で絞り込める" do
      get "/master/treatment_items", params: { kind: "set" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[T0002])
    end

    it "オーダー単位(グループ化/単独)で絞り込める" do
      create_item("T0006", name: "中心静脈カテーテル挿入", groupable: false, display_order: 40)

      get "/master/treatment_items", params: { groupable: "false" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[T0006])

      get "/master/treatment_items", params: { groupable: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[T0002 T0001 T0003])
    end

    it "active=true は有効期間内の項目だけ返す" do
      get "/master/treatment_items", params: { active: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[T0002 T0001])
    end

    it "名称・略称・カナで検索できる" do
      get "/master/treatment_items", params: { name: "創処置" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[T0001])

      get "/master/treatment_items", params: { name: "そうしょうしょち" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[T0001])
    end

    it "keyword でも名称・略称・カナに当たる項目を返す" do
      get "/master/treatment_items", params: { keyword: "創処置" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[T0001])

      get "/master/treatment_items", params: { keyword: "そうしょうしょち" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[T0001])
    end

    it "レセ電算コードに対応する医科診療行為の名称を添える" do
      Master::MedicalProcedure.create!(procedure_code: "140002910", name: "創傷処置（１００平方センチメートル未満）")
      create_item("T0008", name: "創傷処置", receipt_code: "140002910")

      get "/master/treatment_items", params: { item_code: "T0008" }

      expect(body["items"].first["receipt_procedure_name"]).to eq("創傷処置（１００平方センチメートル未満）")
    end
  end

  describe "GET /master/treatment_items/:id" do
    it "セット構成を添えて返す(コードでも引ける)" do
      create_item("T0002", name: "褥瘡処置セット", kind: "set")
      create_item("T0004", name: "創傷処置")
      Master::TreatmentSetItem.create!(set_item_code: "T0002", member_item_code: "T0004", display_order: 1)

      get "/master/treatment_items/T0002"

      expect(body["name"]).to eq("褥瘡処置セット")
      expect(body["set_items"].map { |m| m["member_name"] }).to eq(["創傷処置"])
    end

    it "参照している実施入力用データセットの名称を添えて返す" do
      create_item("T0004", name: "創傷処置", dataset_code: "000001")
      Master::TreatmentDataset.create!(dataset_code: "000001", name: "創傷処置標準セット")

      get "/master/treatment_items/T0004"

      expect(body["dataset_code"]).to eq("000001")
      expect(body["dataset_name"]).to eq("創傷処置標準セット")
    end
  end

  describe "POST /master/treatment_items" do
    it "項目コードを省略すると自動採番する" do
      create_item("000012")

      post "/master/treatment_items", params: { name: "自動採番の項目" }

      expect(body["item_code"]).to eq("000013")
    end

    it "既定はグループ化で、単独オーダーの項目も登録できる" do
      post "/master/treatment_items", params: { item_code: "T0001", name: "既定の項目" }
      expect(body["groupable"]).to be(true)

      post "/master/treatment_items", params: { item_code: "T0006", name: "中心静脈カテーテル挿入",
                                                groupable: false }
      expect(response).to have_http_status(:created)
      expect(body["groupable"]).to be(false)
    end

    it "既定は実施入力ありで、実施入力なしの項目も登録できる" do
      post "/master/treatment_items", params: { item_code: "T0001", name: "既定の項目" }
      expect(body["requires_perform_input"]).to be(true)

      post "/master/treatment_items", params: { item_code: "T0007", name: "とるだけの項目",
                                             requires_perform_input: false }
      expect(response).to have_http_status(:created)
      expect(body["requires_perform_input"]).to be(false)
    end

    it "既定は予約不要で、予約必須の項目は単独オーダーなら登録できる" do
      post "/master/treatment_items", params: { item_code: "T0001", name: "既定の項目" }
      expect(body["requires_appointment"]).to be(false)
      expect(body["duration_minutes"]).to be_nil

      post "/master/treatment_items", params: { item_code: "T0008", name: "人工透析",
                                                requires_appointment: true, groupable: false,
                                                duration_minutes: 30 }
      expect(response).to have_http_status(:created)
      expect(body["requires_appointment"]).to be(true)
      expect(body["duration_minutes"]).to eq(30)
    end

    it "予約必須の項目は予約枠を紐づけて登録でき、予約不要に変えると外れる" do
      post "/master/treatment_items", params: { item_code: "T0010", name: "人工透析",
                                                requires_appointment: true, groupable: false,
                                                appointment_schedule_id: "schedule-1" }
      expect(response).to have_http_status(:created)
      expect(body["appointment_schedule_id"]).to eq("schedule-1")

      patch "/master/treatment_items/T0010", params: { requires_appointment: false }
      expect(response).to have_http_status(:ok)
      expect(body["appointment_schedule_id"]).to be_nil
    end

    it "予約必須の項目はグループ化のままでは登録できない" do
      post "/master/treatment_items", params: { item_code: "T0009", name: "予約必須なのにグループ化",
                                             requires_appointment: true }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("単独オーダー")
    end

    it "実施入力なしの項目はデータセットを持たない" do
      post "/master/treatment_items", params: { item_code: "T0007", name: "とるだけの項目",
                                             requires_perform_input: false, dataset_code: "000001" }

      expect(response).to have_http_status(:created)
      expect(body["dataset_code"]).to be_nil
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/treatment_items", params: { item_code: "T0001", name: "期間おかしい",
                                             valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PATCH /master/treatment_items/:id" do
    it "実施入力なしに変えるとデータセットの参照も外れる" do
      item = create_item("T0004", dataset_code: "000001")

      patch "/master/treatment_items/T0004", params: { requires_perform_input: false }

      expect(response).to have_http_status(:ok)
      expect(item.reload.dataset_code).to be_nil
    end

    it "セットの構成項目は単独オーダーにできない" do
      create_item("T0002", kind: "set")
      create_item("T0004")
      Master::TreatmentSetItem.create!(set_item_code: "T0002", member_item_code: "T0004")

      patch "/master/treatment_items/T0004", params: { groupable: false }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("セットの構成項目")
    end
  end

  describe "DELETE /master/treatment_items/:id" do
    it "ぶら下がるセット構成も片付ける" do
      create_item("T0002", kind: "set")
      create_item("T0004")
      Master::TreatmentSetItem.create!(set_item_code: "T0002", member_item_code: "T0004")

      delete "/master/treatment_items/T0002"

      expect(response).to have_http_status(:no_content)
      expect(Master::TreatmentSetItem.count).to eq(0)
    end

    it "参照していたデータセット本体は他の項目でも使うので残す" do
      create_item("T0004", dataset_code: "000001")
      Master::TreatmentDataset.create!(dataset_code: "000001", name: "創傷処置標準セット")

      delete "/master/treatment_items/T0004"

      expect(Master::TreatmentItem.count).to eq(0)
      expect(Master::TreatmentDataset.count).to eq(1)
    end
  end
end
