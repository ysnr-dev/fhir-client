require "rails_helper"

RSpec.describe "Master::MealItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_item(code, overrides = {})
    Master::MealItem.create!({ item_code: code, name: "項目#{code}" }.merge(overrides))
  end

  describe "GET /master/meal_items" do
    before do
      create_item("A00105", name: "一般食2000kcal", name_kana: "イッパンショク", display_order: 20)
      create_item("105AG", name: "米飯180g", kind: "staple", display_order: 10)
      create_item("A00900", name: "旧食種", valid_to: Date.current - 1, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/meal_items"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[105AG A00105 A00900])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/meal_items", params: { item_code: "A00105,105AG" }
      expect(body["items"].map { |i| i["item_code"] }).to match_array(%w[A00105 105AG])
    end

    it "kind で食種と主食を分けて取得できる" do
      get "/master/meal_items", params: { kind: "diet" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[A00105 A00900])

      get "/master/meal_items", params: { kind: "staple" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[105AG])
    end

    it "active=true は有効期間内の項目だけ返す" do
      get "/master/meal_items", params: { active: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[105AG A00105])
    end

    it "名称・カナで検索できる" do
      get "/master/meal_items", params: { name: "一般食" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[A00105])

      get "/master/meal_items", params: { name: "いっぱんしょく" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[A00105])
    end
  end

  describe "GET /master/meal_items/:id" do
    it "項目コードでも引ける" do
      create_item("A00105", name: "一般食2000kcal")

      get "/master/meal_items/A00105"

      expect(body["name"]).to eq("一般食2000kcal")
    end
  end

  describe "POST /master/meal_items" do
    it "項目コードを省略すると自動採番する" do
      create_item("000012")

      post "/master/meal_items", params: { name: "自動採番の食種" }

      expect(body["item_code"]).to eq("000013")
    end

    it "SS-MIX2 互換のコードは手入力でき、自動採番の計算には混ざらない" do
      create_item("NPO", name: "食止め", is_fasting: true)

      post "/master/meal_items", params: { name: "自動採番の食種" }

      expect(response).to have_http_status(:created)
      expect(body["item_code"]).to eq("000001")
    end

    it "既定は食種で、食止めの食種も登録できる" do
      post "/master/meal_items", params: { item_code: "A00105", name: "一般食2000kcal" }
      expect(body["kind"]).to eq("diet")
      expect(body["is_fasting"]).to be(false)

      post "/master/meal_items", params: { item_code: "NPO", name: "食止め", is_fasting: true }
      expect(response).to have_http_status(:created)
      expect(body["is_fasting"]).to be(true)
    end

    it "主食を食止めにはできない" do
      post "/master/meal_items", params: { item_code: "105AG", name: "米飯180g",
                                           kind: "staple", is_fasting: true }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("食止めにできるのは食種だけ")
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/meal_items", params: { item_code: "A00105", name: "期間おかしい",
                                           valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PATCH /master/meal_items/:id" do
    it "項目コードで更新できる" do
      item = create_item("A00105", name: "一般食2000kcal")

      patch "/master/meal_items/A00105", params: { name: "一般食1800kcal" }

      expect(response).to have_http_status(:ok)
      expect(item.reload.name).to eq("一般食1800kcal")
    end

    it "食種を主食に変えるとき食止めのままでは保存できない" do
      create_item("NPO", name: "食止め", is_fasting: true)

      patch "/master/meal_items/NPO", params: { kind: "staple" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("食止めにできるのは食種だけ")
    end
  end

  describe "DELETE /master/meal_items/:id" do
    it "項目コードで削除できる" do
      create_item("A00105")

      delete "/master/meal_items/A00105"

      expect(response).to have_http_status(:no_content)
      expect(Master::MealItem.count).to eq(0)
    end
  end
end
