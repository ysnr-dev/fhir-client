require "rails_helper"

RSpec.describe "Master::LabResultItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_item(code, overrides = {})
    Master::LabResultItem.create!({ result_item_code: code, name: "項目#{code}" }.merge(overrides))
  end

  describe "GET /master/lab_result_items" do
    before do
      Master::LabSpecimen.create!(specimen_code: "250", name: "血清")
      create_item("R0001", name: "C反応性蛋白", short_name: "CRP", name_kana: "シーアールピー",
                  category: "免疫学的検査", specimen_code: "250", data_type: "PQ",
                  jlac11_code: "E3019000025001385", jlac10_code: "5C070000002306101", display_order: 20)
      create_item("R0002", name: "白血球数", short_name: "WBC", category: "血液学的検査",
                  jlac11_code: "B1002000021156901", display_order: 10)
      create_item("R0003", name: "旧項目", valid_to: Date.current - 1, data_type: "ST", display_order: 30)
    end

    it "表示順で返し、材料名を添える" do
      get "/master/lab_result_items"
      expect(body["items"].map { |i| i["result_item_code"] }).to eq(%w[R0002 R0001 R0003])
      expect(body["items"].find { |i| i["result_item_code"] == "R0001" }["specimen_name"]).to eq("血清")
    end

    it "コード・JLAC11・JLAC10 のカンマ区切りで一括取得できる" do
      get "/master/lab_result_items", params: { result_item_code: "R0001,R0003" }
      expect(body["items"].map { |i| i["result_item_code"] }).to match_array(%w[R0001 R0003])

      get "/master/lab_result_items", params: { jlac11_code: "E3019000025001385,B1002000021156901" }
      expect(body["items"].map { |i| i["result_item_code"] }).to match_array(%w[R0001 R0002])

      get "/master/lab_result_items", params: { jlac10_code: "5C070000002306101" }
      expect(body["items"].map { |i| i["result_item_code"] }).to eq(%w[R0001])
    end

    it "JLAC11 の前方一致(測定物・識別・材料の 12 桁)で引ける" do
      get "/master/lab_result_items", params: { jlac11_prefix: "E30190000250,B10020000211" }
      expect(body["items"].map { |i| i["result_item_code"] }).to match_array(%w[R0001 R0002])

      get "/master/lab_result_items", params: { jlac11_prefix: "E30190000240" }
      expect(body["items"]).to be_empty
    end

    it "検査分野・材料・データ型で絞り込める" do
      get "/master/lab_result_items", params: { category: "免疫学的検査" }
      expect(body["items"].map { |i| i["result_item_code"] }).to eq(%w[R0001])

      get "/master/lab_result_items", params: { specimen_code: "250" }
      expect(body["items"].map { |i| i["result_item_code"] }).to eq(%w[R0001])

      get "/master/lab_result_items", params: { data_type: "ST" }
      expect(body["items"].map { |i| i["result_item_code"] }).to eq(%w[R0003])
    end

    it "active=true は有効期間内の項目だけ返す" do
      get "/master/lab_result_items", params: { active: "true" }
      expect(body["items"].map { |i| i["result_item_code"] }).to eq(%w[R0002 R0001])
    end

    it "名称・略称・カナで検索できる" do
      get "/master/lab_result_items", params: { name: "crp" }
      expect(body["items"].map { |i| i["result_item_code"] }).to eq(%w[R0001])

      get "/master/lab_result_items", params: { name: "しーあーるぴー" }
      expect(body["items"].map { |i| i["result_item_code"] }).to eq(%w[R0001])
    end
  end

  describe "GET /master/lab_result_items/:id" do
    it "材料名と、この項目を返すオーダー項目を添えて返す(コードでも引ける)" do
      Master::LabSpecimen.create!(specimen_code: "223", name: "全血(動脈血)")
      Master::LabOrderItem.create!(order_item_code: "O0001", name: "血液ガス分析")
      create_item("R0010", name: "血液ガス pH", specimen_code: "223")
      Master::LabOrderItemResult.create!(order_item_code: "O0001", result_item_code: "R0010")

      get "/master/lab_result_items/R0010"

      expect(body["specimen_name"]).to eq("全血(動脈血)")
      expect(body["order_items"].map { |o| o["order_item_name"] }).to eq(["血液ガス分析"])
    end
  end

  describe "CRUD" do
    it "作成・更新・削除できる" do
      post "/master/lab_result_items", params: {
        result_item_code: "R0020", name: "HBs抗原", data_type: "CO",
        code_value_list: "1：陰性、2：陽性", value_code_system: "urn:oid:1.2.392.200119.6.1006",
        jlac11_code: "V2010000025000002", valid_from: "2026-08-01",
      }, as: :json
      expect(response).to have_http_status(:created)
      id = body["id"]

      patch "/master/lab_result_items/#{id}", params: { short_name: "HBsAg" }, as: :json
      expect(body["short_name"]).to eq("HBsAg")

      delete "/master/lab_result_items/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "コードの二重登録・不正なデータ型・逆転した有効期間は登録できない" do
      create_item("R0020")

      post "/master/lab_result_items", params: { result_item_code: "R0020", name: "重複" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/lab_result_items", params: { result_item_code: "R0021", name: "x", data_type: "NM" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/lab_result_items", params: {
        result_item_code: "R0021", name: "x", valid_from: "2026-08-01", valid_to: "2026-07-01",
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "消すとぶら下がる対応表も消える" do
      create_item("R0010")
      Master::LabOrderItemResult.create!(order_item_code: "O0001", result_item_code: "R0010")

      delete "/master/lab_result_items/R0010"

      expect(response).to have_http_status(:no_content)
      expect(Master::LabOrderItemResult.count).to eq(0)
    end
  end
end
