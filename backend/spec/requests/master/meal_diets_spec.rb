require "rails_helper"

RSpec.describe "Master::MealDiets", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_diet(code, overrides = {})
    Master::MealDiet.create!({ item_code: code, name: "食種#{code}" }.merge(overrides))
  end

  describe "GET /master/meal_diets" do
    before do
      create_diet("A00105", name: "一般食2000kcal", name_kana: "イッパンショク", display_order: 20)
      create_diet("NPO", name: "食止め", is_fasting: true, display_order: 90)
      create_diet("A00900", name: "旧食種", valid_to: Date.current - 1, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/meal_diets"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[A00105 A00900 NPO])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/meal_diets", params: { item_code: "A00105,NPO" }
      expect(body["items"].map { |i| i["item_code"] }).to match_array(%w[A00105 NPO])
    end

    it "active=true は有効期間内の食種だけ返す" do
      get "/master/meal_diets", params: { active: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[A00105 NPO])
    end

    it "種別(category_code)で絞り込める" do
      Master::MealCategory.create!(category_code: "01", name: "一般食")
      create_diet("A00201", name: "糖尿病食1600kcal", category_code: "01", display_order: 40)

      get "/master/meal_diets", params: { category_code: "01" }

      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[A00201])
    end

    it "名称・カナで検索できる" do
      get "/master/meal_diets", params: { name: "一般食" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[A00105])

      get "/master/meal_diets", params: { name: "いっぱんしょく" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[A00105])
    end

    it "選択画面向けに 1 ページ 500 件まで引ける" do
      get "/master/meal_diets", params: { per: 500 }
      expect(body["per"]).to eq(500)
    end
  end

  describe "GET /master/meal_diets/:id" do
    it "食種コードでも引ける" do
      create_diet("A00105", name: "一般食2000kcal")

      get "/master/meal_diets/A00105"

      expect(body["name"]).to eq("一般食2000kcal")
    end
  end

  describe "POST /master/meal_diets" do
    it "食種コードを省略すると自動採番する" do
      create_diet("000012")

      post "/master/meal_diets", params: { name: "自動採番の食種" }

      expect(body["item_code"]).to eq("000013")
    end

    it "SS-MIX2 互換のコードは手入力でき、自動採番の計算には混ざらない" do
      create_diet("NPO", name: "食止め", is_fasting: true)

      post "/master/meal_diets", params: { name: "自動採番の食種" }

      expect(response).to have_http_status(:created)
      expect(body["item_code"]).to eq("000001")
    end

    it "主成分量と適応を持てる" do
      post "/master/meal_diets", params: { item_code: "A00201", name: "糖尿病食1600kcal",
                                           energy_kcal: 1600, protein_g: 70, fat_g: 45,
                                           carbohydrate_g: 220, salt_g: 7,
                                           indication: "糖尿病・耐糖能異常" }

      expect(response).to have_http_status(:created)
      expect(body["energy_kcal"]).to eq("1600.0")
      expect(body["water_ml"]).to be_nil
      expect(body["indication"]).to eq("糖尿病・耐糖能異常")
    end

    it "主成分量に負の値は入れられない" do
      post "/master/meal_diets", params: { item_code: "A00201", name: "糖尿病食", salt_g: -1 }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("Salt g")
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/meal_diets", params: { item_code: "A00105", name: "期間おかしい",
                                           valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PATCH /master/meal_diets/:id" do
    it "食種コードで更新できる" do
      diet = create_diet("A00105", name: "一般食2000kcal")

      patch "/master/meal_diets/A00105", params: { name: "一般食1800kcal", energy_kcal: 1800 }

      expect(response).to have_http_status(:ok)
      expect(diet.reload.name).to eq("一般食1800kcal")
      expect(diet.energy_kcal).to eq(1800)
    end
  end

  describe "DELETE /master/meal_diets/:id" do
    it "食種コードで削除できる" do
      create_diet("A00105")

      delete "/master/meal_diets/A00105"

      expect(response).to have_http_status(:no_content)
      expect(Master::MealDiet.count).to eq(0)
    end
  end
end
