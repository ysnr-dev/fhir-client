require "rails_helper"

RSpec.describe "Master::LabOrderItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_item(code, overrides = {})
    Master::LabOrderItem.create!({ order_item_code: code, name: "項目#{code}" }.merge(overrides))
  end

  describe "GET /master/lab_order_items" do
    before do
      create_item("L0001", name: "C反応性蛋白", short_name: "CRP", name_kana: "シーアールピー",
                  category: "免疫学的検査", specimen_code: "019", display_order: 20)
      create_item("L0002", name: "末梢血液一般検査", short_name: "CBC", kind: "panel",
                  category: "血液学的検査", display_order: 10)
      create_item("L0003", name: "旧項目", valid_to: Date.current - 1, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/lab_order_items"
      expect(body["items"].map { |i| i["order_item_code"] }).to eq(%w[L0002 L0001 L0003])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/lab_order_items", params: { order_item_code: "L0001,L0003" }
      expect(body["items"].map { |i| i["order_item_code"] }).to match_array(%w[L0001 L0003])
    end

    it "kind・検査分野・検体で絞り込める" do
      get "/master/lab_order_items", params: { kind: "panel" }
      expect(body["items"].map { |i| i["order_item_code"] }).to eq(%w[L0002])

      get "/master/lab_order_items", params: { category: "免疫学的検査" }
      expect(body["items"].map { |i| i["order_item_code"] }).to eq(%w[L0001])

      get "/master/lab_order_items", params: { specimen_code: "019" }
      expect(body["items"].map { |i| i["order_item_code"] }).to eq(%w[L0001])
    end

    it "active=true は有効期間内の項目だけ返す" do
      get "/master/lab_order_items", params: { active: "true" }
      expect(body["items"].map { |i| i["order_item_code"] }).to eq(%w[L0002 L0001])
    end

    it "名称・略称・カナで検索できる" do
      get "/master/lab_order_items", params: { name: "crp" }
      expect(body["items"].map { |i| i["order_item_code"] }).to eq(%w[L0001])

      get "/master/lab_order_items", params: { name: "しーあーるぴー" }
      expect(body["items"].map { |i| i["order_item_code"] }).to eq(%w[L0001])
    end
  end

  describe "GET /master/lab_order_items/categories" do
    it "検査分野を表示順で返す" do
      create_item("L0001", category: "免疫学的検査", display_order: 20)
      create_item("L0002", category: "血液学的検査", display_order: 10)

      get "/master/lab_order_items/categories"
      expect(body).to eq(%w[血液学的検査 免疫学的検査])
    end
  end

  describe "GET /master/lab_order_items/:id" do
    it "検体・採取管・パネル構成を添えて返す(コードでも引ける)" do
      Master::LabSpecimen.create!(specimen_code: "019", name: "血液", default_container_code: "T03")
      Master::LabContainer.create!(container_code: "T03", name: "EDTA-2K管", cap_color: "紫")
      create_item("L0002", name: "末梢血液一般検査", kind: "panel", specimen_code: "019")
      create_item("L0003", name: "白血球数")
      Master::LabPanelItem.create!(panel_item_code: "L0002", member_item_code: "L0003", display_order: 1)

      get "/master/lab_order_items/L0002"

      expect(body["specimen"]["name"]).to eq("血液")
      # 項目に採取管の指定が無いので、検体の既定採取管が返る。
      expect(body["container"]["container_code"]).to eq("T03")
      expect(body["panel_items"].map { |m| m["member_name"] }).to eq(["白血球数"])
    end

    it "項目の採取管指定が検体の既定より優先される" do
      Master::LabSpecimen.create!(specimen_code: "019", name: "血液", default_container_code: "T03")
      Master::LabContainer.create!(container_code: "T06", name: "フッ化Na管")
      create_item("L0004", name: "血糖", specimen_code: "019", container_code: "T06")

      get "/master/lab_order_items/L0004"

      expect(body["container"]["container_code"]).to eq("T06")
    end
  end

  describe "CRUD" do
    it "作成・更新・削除できる" do
      post "/master/lab_order_items", params: {
        order_item_code: "L0010", name: "HbA1c(NGSP)", short_name: "HbA1c",
        category: "生化学検査", kind: "single",
        jlac_code: "B3009000021103112", jlac_code_system: "jlac11",
        valid_from: "2026-08-01", execution_type: "outsourced", receipt_code: "3D046",
      }, as: :json
      expect(response).to have_http_status(:created)
      id = body["id"]

      patch "/master/lab_order_items/#{id}", params: { short_name: "A1c" }, as: :json
      expect(body["short_name"]).to eq("A1c")

      delete "/master/lab_order_items/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "コードの二重登録・不正な体系・逆転した有効期間は登録できない" do
      create_item("L0010")

      post "/master/lab_order_items", params: { order_item_code: "L0010", name: "重複" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/lab_order_items", params: {
        order_item_code: "L0011", name: "x", jlac_code_system: "loinc",
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/lab_order_items", params: {
        order_item_code: "L0011", name: "x", valid_from: "2026-08-01", valid_to: "2026-07-01",
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "消すとぶら下がるパネル構成も消える" do
      create_item("L0002", kind: "panel")
      create_item("L0003")
      Master::LabPanelItem.create!(panel_item_code: "L0002", member_item_code: "L0003")

      delete "/master/lab_order_items/L0002"

      expect(response).to have_http_status(:no_content)
      expect(Master::LabPanelItem.count).to eq(0)
    end
  end
end
