require "rails_helper"

RSpec.describe "Master::SurgeryCategories", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_category(code, name, parent_code = nil, overrides = {})
    Master::SurgeryCategory.create!(
      { category_code: code, name: name, parent_code: parent_code }.merge(overrides)
    )
  end

  describe "GET /master/surgery_categories" do
    before do
      create_category("09", "腹部", nil, name_kana: "フクブ", display_order: 1)
      create_category("0901", "腹壁、ヘルニア", "09", display_order: 1)
      create_category("0902", "胃、食道、腸、他", "09", display_order: 2)
      create_category("10", "尿路系・副腎", nil, display_order: 2,
                                                valid_from: Date.current - 100, valid_to: Date.current - 1)
    end

    it "表示順・コード順で一覧を返す" do
      get "/master/surgery_categories"

      expect(body["items"].map { |i| i["category_code"] }).to eq(%w[09 0901 0902 10])
    end

    it "active=true は有効期間内の分類だけ返す" do
      get "/master/surgery_categories", params: { active: "true" }

      expect(body["items"].map { |i| i["category_code"] }).to match_array(%w[09 0901 0902])
    end

    it "parent_code で直下の子だけ引ける(空文字は最上位)" do
      get "/master/surgery_categories", params: { parent_code: "09" }
      expect(body["items"].map { |i| i["category_code"] }).to eq(%w[0901 0902])

      get "/master/surgery_categories", params: { parent_code: "" }
      expect(body["items"].map { |i| i["category_code"] }).to eq(%w[09 10])
    end

    it "分類コードをカンマ区切りで複数指定できる" do
      get "/master/surgery_categories", params: { category_code: "09,0902" }

      expect(body["items"].map { |i| i["category_code"] }).to match_array(%w[09 0902])
    end

    it "名称・カナで検索できる" do
      get "/master/surgery_categories", params: { name: "ふくぶ" }

      expect(body["items"].map { |i| i["category_code"] }).to eq(%w[09])
    end

    it "選択肢をまとめて引けるよう per は 100 件を超えて指定できる" do
      get "/master/surgery_categories", params: { per: 300 }

      expect(body["per"]).to eq(300)
    end
  end

  describe "GET /master/surgery_categories/:id" do
    it "分類コードでも id でも引ける" do
      record = create_category("09", "腹部")

      get "/master/surgery_categories/09"
      expect(body["name"]).to eq("腹部")

      get "/master/surgery_categories/#{record.id}"
      expect(body["category_code"]).to eq("09")
    end
  end

  describe "POST /master/surgery_categories" do
    it "最上位は2桁で自動採番する" do
      create_category("07", "胸部")

      post "/master/surgery_categories", params: { name: "腹部" }

      expect(response).to have_http_status(:created)
      expect(body["category_code"]).to eq("08")
    end

    it "親を指定すると親コードに2桁を足して自動採番する" do
      create_category("09", "腹部")
      create_category("0901", "腹壁、ヘルニア", "09")

      post "/master/surgery_categories", params: { name: "胃、食道、腸、他", parent_code: "09" }

      expect(body["category_code"]).to eq("0902")
    end

    it "存在しない親は登録できない" do
      post "/master/surgery_categories", params: { name: "腹壁", parent_code: "99" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("分類がありません")
    end

    it "自分自身は親にできない" do
      post "/master/surgery_categories", params: { category_code: "09", name: "腹部", parent_code: "09" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("自分自身")
    end
  end

  describe "PATCH /master/surgery_categories/:id" do
    it "配下の分類は親にできない(輪ができるため)" do
      create_category("09", "腹部")
      create_category("0901", "腹壁、ヘルニア", "09")

      patch "/master/surgery_categories/09", params: { parent_code: "0901" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("配下の分類")
    end
  end

  describe "DELETE /master/surgery_categories/:id" do
    it "配下の分類があると削除できない" do
      create_category("09", "腹部")
      create_category("0901", "腹壁、ヘルニア", "09")

      delete "/master/surgery_categories/09"

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::SurgeryCategory.exists?(category_code: "09")).to be(true)
    end

    it "参照していた術式は消さず未分類に戻す" do
      create_category("0901", "腹壁、ヘルニア")
      Master::SurgeryItem.create!(item_code: "S0001", name: "鼠径ヘルニア手術", category_code: "0901")

      delete "/master/surgery_categories/0901"

      expect(response).to have_http_status(:no_content)
      expect(Master::SurgeryItem.find_by(item_code: "S0001").category_code).to be_nil
    end
  end
end
