require "rails_helper"

RSpec.describe "Master::PhysioItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_item(code, overrides = {})
    Master::PhysioItem.create!({ item_code: code, name: "項目#{code}" }.merge(overrides))
  end

  describe "GET /master/physio_items" do
    before do
      create_item("P0001", name: "心電図12誘導", short_name: "ECG12", name_kana: "シンデンズ",
                  exam_type_code: "01", display_order: 20)
      create_item("P0002", name: "心肺機能セット", kind: "set", display_order: 10)
      create_item("P0003", name: "旧項目", valid_to: Date.current - 1, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/physio_items"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0002 P0001 P0003])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/physio_items", params: { item_code: "P0001,P0003" }
      expect(body["items"].map { |i| i["item_code"] }).to match_array(%w[P0001 P0003])
    end

    it "kind・検査種別で絞り込める" do
      get "/master/physio_items", params: { kind: "set" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0002])

      get "/master/physio_items", params: { exam_type_code: "01" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0001])
    end

    it "オーダー単位(グループ化/単独)で絞り込める" do
      create_item("P0006", name: "腹部超音波", groupable: false, display_order: 40)

      get "/master/physio_items", params: { groupable: "false" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0006])

      get "/master/physio_items", params: { groupable: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0002 P0001 P0003])
    end

    it "active=true は有効期間内の項目だけ返す" do
      get "/master/physio_items", params: { active: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0002 P0001])
    end

    it "名称・略称・カナで検索できる" do
      get "/master/physio_items", params: { name: "ecg12" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0001])

      get "/master/physio_items", params: { name: "しんでんず" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0001])
    end

    it "keyword は名称・検査種別のどちらかに当たる項目を返す" do
      Master::PhysioExamType.create!(exam_type_code: "02", name: "超音波検査", short_name: "US")
      # 名称に「超音波」が入っていない項目でも検査種別から引ける。
      create_item("P0007", name: "腹部エコー", exam_type_code: "02")

      get "/master/physio_items", params: { keyword: "超音波" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0007])

      get "/master/physio_items", params: { keyword: "us" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0007])

      get "/master/physio_items", params: { keyword: "しんでんず" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[P0001])
    end

    it "一覧に載っている検査種別の名称を添える" do
      Master::PhysioExamType.create!(exam_type_code: "01", name: "心電図")

      get "/master/physio_items"

      expect(body["exam_types"]).to eq("01" => "心電図")
    end

    it "レセ電算コードに対応する医科診療行為の名称を添える" do
      Master::MedicalProcedure.create!(procedure_code: "160067810", name: "呼吸機能検査等判断料")
      create_item("P0008", name: "スパイロメトリー", receipt_code: "160067810")

      get "/master/physio_items", params: { item_code: "P0008" }

      expect(body["items"].first["receipt_procedure_name"]).to eq("呼吸機能検査等判断料")
    end
  end

  describe "GET /master/physio_items/:id" do
    it "検査種別の名称とセット構成を添えて返す(コードでも引ける)" do
      Master::PhysioExamType.create!(exam_type_code: "01", name: "心電図")
      create_item("P0002", name: "心肺機能セット", kind: "set")
      create_item("P0004", name: "心電図12誘導", exam_type_code: "01")
      Master::PhysioSetItem.create!(set_item_code: "P0002", member_item_code: "P0004", display_order: 1)

      get "/master/physio_items/P0002"

      expect(body["name"]).to eq("心肺機能セット")
      expect(body["set_items"].map { |m| m["member_name"] }).to eq(["心電図12誘導"])
      # セット自身は種別を持たないので、名称は構成項目の分を解決して返す。
      expect(body["set_items"].first["member_exam_type_code"]).to eq("01")
      expect(body["exam_types"]).to eq("01" => "心電図")
    end

    it "参照している実施入力用データセットの名称を添えて返す" do
      create_item("P0004", name: "負荷心電図", dataset_code: "000001")
      Master::PhysioDataset.create!(dataset_code: "000001", name: "負荷心電図標準セット")

      get "/master/physio_items/P0004"

      expect(body["dataset_code"]).to eq("000001")
      expect(body["dataset_name"]).to eq("負荷心電図標準セット")
    end
  end

  describe "POST /master/physio_items" do
    it "項目コードを省略すると自動採番する" do
      create_item("000012")

      post "/master/physio_items", params: { name: "自動採番の項目" }

      expect(body["item_code"]).to eq("000013")
    end

    it "検査目的・特別指示の既定テンプレートを保存する" do
      post "/master/physio_items", params: {
        item_code: "P0001", name: "心電図12誘導",
        purpose_template_canonical: "http://example.com/Questionnaire/physio-purpose|1.0",
        remarks_template_canonical: "http://example.com/Questionnaire/physio-remarks"
      }

      expect(response).to have_http_status(:created)
      record = Master::PhysioItem.find_by(item_code: "P0001")
      expect(record.purpose_template_canonical).to eq("http://example.com/Questionnaire/physio-purpose|1.0")
      expect(record.remarks_template_canonical).to eq("http://example.com/Questionnaire/physio-remarks")
    end

    it "既定はグループ化で、単独オーダーの項目も登録できる" do
      post "/master/physio_items", params: { item_code: "P0001", name: "既定の項目" }
      expect(body["groupable"]).to be(true)

      post "/master/physio_items", params: { item_code: "P0006", name: "腹部超音波", groupable: false }
      expect(response).to have_http_status(:created)
      expect(body["groupable"]).to be(false)
    end

    it "既定は実施入力ありで、実施入力なしの項目も登録できる" do
      post "/master/physio_items", params: { item_code: "P0001", name: "既定の項目" }
      expect(body["requires_perform_input"]).to be(true)

      post "/master/physio_items", params: { item_code: "P0007", name: "とるだけの項目",
                                             requires_perform_input: false }
      expect(response).to have_http_status(:created)
      expect(body["requires_perform_input"]).to be(false)
    end

    it "既定は予約不要で、予約必須の項目は単独オーダーなら登録できる" do
      post "/master/physio_items", params: { item_code: "P0001", name: "既定の項目" }
      expect(body["requires_appointment"]).to be(false)
      expect(body["duration_minutes"]).to be_nil

      post "/master/physio_items", params: { item_code: "P0008", name: "心エコー",
                                             requires_appointment: true, groupable: false,
                                             duration_minutes: 30 }
      expect(response).to have_http_status(:created)
      expect(body["requires_appointment"]).to be(true)
      expect(body["duration_minutes"]).to eq(30)
    end

    it "予約必須の項目は予約枠を紐づけて登録でき、予約不要に変えると外れる" do
      post "/master/physio_items", params: { item_code: "P0010", name: "心エコー",
                                             requires_appointment: true, groupable: false,
                                             appointment_schedule_id: "schedule-1" }
      expect(response).to have_http_status(:created)
      expect(body["appointment_schedule_id"]).to eq("schedule-1")

      patch "/master/physio_items/P0010", params: { requires_appointment: false }
      expect(response).to have_http_status(:ok)
      expect(body["appointment_schedule_id"]).to be_nil
    end

    it "予約必須の項目はグループ化のままでは登録できない" do
      post "/master/physio_items", params: { item_code: "P0009", name: "予約必須なのにグループ化",
                                             requires_appointment: true }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("単独オーダー")
    end

    it "実施入力なしの項目はデータセットを持たない" do
      post "/master/physio_items", params: { item_code: "P0007", name: "とるだけの項目",
                                             requires_perform_input: false, dataset_code: "000001" }

      expect(response).to have_http_status(:created)
      expect(body["dataset_code"]).to be_nil
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/physio_items", params: { item_code: "P0001", name: "期間おかしい",
                                             valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PATCH /master/physio_items/:id" do
    it "実施入力なしに変えるとデータセットの参照も外れる" do
      item = create_item("P0004", dataset_code: "000001")

      patch "/master/physio_items/P0004", params: { requires_perform_input: false }

      expect(response).to have_http_status(:ok)
      expect(item.reload.dataset_code).to be_nil
    end

    it "セットの構成項目は単独オーダーにできない" do
      create_item("P0002", kind: "set")
      create_item("P0004")
      Master::PhysioSetItem.create!(set_item_code: "P0002", member_item_code: "P0004")

      patch "/master/physio_items/P0004", params: { groupable: false }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("セットの構成項目")
    end
  end

  describe "DELETE /master/physio_items/:id" do
    it "ぶら下がるセット構成も片付ける" do
      create_item("P0002", kind: "set")
      create_item("P0004")
      Master::PhysioSetItem.create!(set_item_code: "P0002", member_item_code: "P0004")

      delete "/master/physio_items/P0002"

      expect(response).to have_http_status(:no_content)
      expect(Master::PhysioSetItem.count).to eq(0)
    end

    it "参照していたデータセット本体は他の項目でも使うので残す" do
      create_item("P0004", dataset_code: "000001")
      Master::PhysioDataset.create!(dataset_code: "000001", name: "負荷心電図標準セット")

      delete "/master/physio_items/P0004"

      expect(Master::PhysioItem.count).to eq(0)
      expect(Master::PhysioDataset.count).to eq(1)
    end
  end
end
