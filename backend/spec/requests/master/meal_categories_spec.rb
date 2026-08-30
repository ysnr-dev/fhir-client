require "rails_helper"

RSpec.describe "Master::MealCategories", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/meal_categories" do
    before do
      Master::MealCategory.create!(category_code: "01", name: "一般食", name_kana: "イッパンショク",
                                   display_order: 1)
      Master::MealCategory.create!(category_code: "02", name: "特別食", display_order: 2)
      Master::MealCategory.create!(category_code: "03", name: "廃止した種別", display_order: 3,
                                   valid_from: Date.current - 100, valid_to: Date.current - 1)
    end

    it "表示順で一覧を返す" do
      get "/master/meal_categories"

      expect(body["items"].map { |i| i["category_code"] }).to eq(%w[01 02 03])
    end

    it "active=true は有効期間内の種別だけ返す" do
      get "/master/meal_categories", params: { active: "true" }

      expect(body["items"].map { |i| i["category_code"] }).to eq(%w[01 02])
    end

    it "種別コードをカンマ区切りで複数指定できる" do
      get "/master/meal_categories", params: { category_code: "01,03" }

      expect(body["items"].map { |i| i["category_code"] }).to eq(%w[01 03])
    end

    it "名称・カナで検索できる" do
      get "/master/meal_categories", params: { name: "いっぱん" }

      expect(body["items"].map { |i| i["category_code"] }).to eq(%w[01])
    end
  end

  describe "POST /master/meal_categories" do
    it "種別コードを省略すると2桁で自動採番する" do
      Master::MealCategory.create!(category_code: "07", name: "既存")

      post "/master/meal_categories", params: { name: "特別食" }

      expect(response).to have_http_status(:created)
      expect(body["category_code"]).to eq("08")
    end

    it "給与形態の既定は普通食・治療食(oral_diet)" do
      post "/master/meal_categories", params: { name: "特別食" }

      expect(response).to have_http_status(:created)
      expect(body["nutrition_form"]).to eq("oral_diet")
    end

    it "給与形態に経管・経口食と調乳食を指定できる" do
      post "/master/meal_categories", params: { name: "経管栄養", nutrition_form: "enteral_formula" }
      expect(body["nutrition_form"]).to eq("enteral_formula")

      post "/master/meal_categories", params: { name: "乳児食", nutrition_form: "infant_formula" }
      expect(body["nutrition_form"]).to eq("infant_formula")
    end

    it "知らない給与形態は登録できない" do
      post "/master/meal_categories", params: { name: "欠食", nutrition_form: "fasting" }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "DELETE /master/meal_categories/:id" do
    it "参照していた食種は消さず未分類に戻す" do
      Master::MealCategory.create!(category_code: "01", name: "一般食")
      Master::MealItem.create!(item_code: "A00105", name: "一般食2000kcal", kind: "diet",
                               category_code: "01")

      delete "/master/meal_categories/01"

      expect(response).to have_http_status(:no_content)
      expect(Master::MealItem.find_by(item_code: "A00105").category_code).to be_nil
    end
  end
end
