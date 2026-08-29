require "rails_helper"

RSpec.describe "Master::SurgeryItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_item(code, overrides = {})
    Master::SurgeryItem.create!({ item_code: code, name: "術式#{code}" }.merge(overrides))
  end

  describe "GET /master/surgery_items" do
    before do
      create_item("S0001", name: "腹腔鏡下胆嚢摘出術", short_name: "ラパコレ", name_kana: "フククウキョウカタンノウテキシュツジュツ",
                  display_order: 20)
      create_item("S0002", name: "鼠径ヘルニア手術", display_order: 10)
      create_item("S0003", name: "旧術式", valid_to: Date.current - 1, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/surgery_items"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[S0002 S0001 S0003])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/surgery_items", params: { item_code: "S0001,S0003" }
      expect(body["items"].map { |i| i["item_code"] }).to match_array(%w[S0001 S0003])
    end

    it "active=true は有効期間内の項目だけ返す" do
      get "/master/surgery_items", params: { active: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[S0002 S0001])
    end

    it "名称・略称・カナで検索できる" do
      get "/master/surgery_items", params: { name: "ラパコレ" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[S0001])

      get "/master/surgery_items", params: { keyword: "ふくくうきょうかたんのう" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[S0001])
    end

    it "種別(category_code)で絞り込むと配下の分類の術式も出る" do
      Master::SurgeryCategory.create!(category_code: "09", name: "腹部")
      Master::SurgeryCategory.create!(category_code: "0901", name: "腹壁、ヘルニア", parent_code: "09")
      Master::SurgeryCategory.create!(category_code: "10", name: "尿路系・副腎")
      create_item("S0011", name: "鼠径ヘルニア手術", category_code: "0901", display_order: 1)
      create_item("S0012", name: "腹部の何か", category_code: "09", display_order: 2)
      create_item("S0013", name: "腎摘出術", category_code: "10", display_order: 3)

      get "/master/surgery_items", params: { category_code: "09" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[S0011 S0012])

      get "/master/surgery_items", params: { category_code: "0901" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[S0011])
    end

    it "レセ電算コードに対応する医科診療行為の名称を添える" do
      Master::MedicalProcedure.create!(procedure_code: "150183010", name: "胆嚢摘出術")
      create_item("S0008", name: "胆嚢摘出術(開腹)", receipt_code: "150183010")

      get "/master/surgery_items", params: { item_code: "S0008" }

      expect(body["items"].first["receipt_procedure_name"]).to eq("胆嚢摘出術")
    end
  end

  describe "GET /master/surgery_items/:id" do
    it "コードでも引け、レセ電算コードの名称を添えて返す" do
      Master::MedicalProcedure.create!(procedure_code: "150183010", name: "胆嚢摘出術")
      create_item("S0001", name: "腹腔鏡下胆嚢摘出術", receipt_code: "150183010")

      get "/master/surgery_items/S0001"

      expect(body["name"]).to eq("腹腔鏡下胆嚢摘出術")
      expect(body["receipt_procedure_name"]).to eq("胆嚢摘出術")
    end
  end

  describe "POST /master/surgery_items" do
    it "項目コードを省略すると自動採番する" do
      create_item("000012")

      post "/master/surgery_items", params: { name: "自動採番の術式" }

      expect(body["item_code"]).to eq("000013")
    end

    it "既定値(所要時間・到達法・体位・麻酔方法)を持てる" do
      post "/master/surgery_items", params: { item_code: "S0001", name: "腹腔鏡下胆嚢摘出術",
                                              default_duration_minutes: 120,
                                              default_approach: "laparoscopic",
                                              default_position: "supine",
                                              default_anesthesia_methods: "general-inhalation,epidural" }

      expect(response).to have_http_status(:created)
      expect(body["default_duration_minutes"]).to eq(120)
      expect(body["default_approach"]).to eq("laparoscopic")
      expect(body["default_position"]).to eq("supine")
      expect(body["default_anesthesia_methods"]).to eq("general-inhalation,epidural")
    end

    it "左右必須の術式を登録できる(既定は不要)" do
      post "/master/surgery_items", params: { item_code: "S0001", name: "既定の術式" }
      expect(body["requires_laterality"]).to be(false)

      post "/master/surgery_items", params: { item_code: "S0002", name: "鼠径ヘルニア手術",
                                              requires_laterality: true }
      expect(response).to have_http_status(:created)
      expect(body["requires_laterality"]).to be(true)
    end

    it "術前指示の既定テンプレートを保存する" do
      post "/master/surgery_items", params: {
        item_code: "S0001", name: "腹腔鏡下胆嚢摘出術",
        preop_template_canonical: "http://fhir-client.local/Questionnaire/sur-preop-01|1.0.0"
      }

      expect(response).to have_http_status(:created)
      record = Master::SurgeryItem.find_by(item_code: "S0001")
      expect(record.preop_template_canonical)
        .to eq("http://fhir-client.local/Questionnaire/sur-preop-01|1.0.0")
    end

    it "所要時間は正の整数だけを受け付ける" do
      post "/master/surgery_items", params: { item_code: "S0001", name: "所要時間おかしい",
                                              default_duration_minutes: 0 }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/surgery_items", params: { item_code: "S0001", name: "期間おかしい",
                                              valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PATCH /master/surgery_items/:id" do
    it "コードで引いて更新できる" do
      create_item("S0001", name: "腹腔鏡下胆嚢摘出術")

      patch "/master/surgery_items/S0001", params: { short_name: "ラパコレ" }

      expect(response).to have_http_status(:ok)
      expect(body["short_name"]).to eq("ラパコレ")
    end
  end

  describe "DELETE /master/surgery_items/:id" do
    it "削除できる" do
      create_item("S0001")

      delete "/master/surgery_items/S0001"

      expect(response).to have_http_status(:no_content)
      expect(Master::SurgeryItem.count).to eq(0)
    end
  end
end
