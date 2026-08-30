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
      create_item("105AG", name: "米飯180g", name_kana: "ベイハン", display_order: 10)
      create_item("105AK", name: "全粥", display_order: 20)
      create_item("105ZZ", name: "旧主食", valid_to: Date.current - 1, display_order: 30)
      create_item("F02", name: "きざみ", kind: "side_dish_form", display_order: 50)
    end

    it "表示順で返す" do
      get "/master/meal_items"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[105AG 105AK 105ZZ F02])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/meal_items", params: { item_code: "105AG,F02" }
      expect(body["items"].map { |i| i["item_code"] }).to match_array(%w[105AG F02])
    end

    it "kind で主食・副食形態を分けて取得できる" do
      get "/master/meal_items", params: { kind: "staple" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[105AG 105AK 105ZZ])

      get "/master/meal_items", params: { kind: "side_dish_form" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[F02])
    end

    it "active=true は有効期間内の項目だけ返す" do
      get "/master/meal_items", params: { active: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[105AG 105AK F02])
    end

    it "名称・カナで検索できる" do
      get "/master/meal_items", params: { name: "米飯" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[105AG])

      get "/master/meal_items", params: { name: "べいはん" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[105AG])
    end
  end

  describe "GET /master/meal_items/:id" do
    it "項目コードでも引ける" do
      create_item("105AG", name: "米飯180g")

      get "/master/meal_items/105AG"

      expect(body["name"]).to eq("米飯180g")
    end
  end

  describe "POST /master/meal_items" do
    it "項目コードを省略すると自動採番する" do
      create_item("000012")

      post "/master/meal_items", params: { name: "自動採番の主食" }

      expect(body["item_code"]).to eq("000013")
    end

    it "SS-MIX2 互換のコードは手入力でき、自動採番の計算には混ざらない" do
      create_item("105AG", name: "米飯180g")

      post "/master/meal_items", params: { name: "自動採番の主食" }

      expect(response).to have_http_status(:created)
      expect(body["item_code"]).to eq("000001")
    end

    it "既定は主食で、副食形態も登録できる" do
      post "/master/meal_items", params: { item_code: "105AG", name: "米飯180g" }
      expect(body["kind"]).to eq("staple")

      post "/master/meal_items", params: { item_code: "F02", name: "きざみ", kind: "side_dish_form" }
      expect(response).to have_http_status(:created)
      expect(body["kind"]).to eq("side_dish_form")
    end

    it "食種は別マスタなので kind に diet は入れられない" do
      post "/master/meal_items", params: { item_code: "A00105", name: "一般食", kind: "diet" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/meal_items", params: { item_code: "105AG", name: "期間おかしい",
                                           valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PATCH /master/meal_items/:id" do
    it "項目コードで更新できる" do
      item = create_item("105AG", name: "米飯180g")

      patch "/master/meal_items/105AG", params: { name: "米飯200g" }

      expect(response).to have_http_status(:ok)
      expect(item.reload.name).to eq("米飯200g")
    end
  end

  describe "DELETE /master/meal_items/:id" do
    it "項目コードで削除できる" do
      create_item("105AG")

      delete "/master/meal_items/105AG"

      expect(response).to have_http_status(:no_content)
      expect(Master::MealItem.count).to eq(0)
    end
  end
end
