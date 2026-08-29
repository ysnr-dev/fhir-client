require "rails_helper"

RSpec.describe "Master::TransfusionProducts", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_product(code, overrides = {})
    Master::TransfusionProduct.create!({ item_code: code, name: "製剤#{code}" }.merge(overrides))
  end

  describe "GET /master/transfusion_products" do
    before do
      create_product("000001", name: "赤血球液-LR「日赤」2単位", name_kana: "セッケッキュウエキ",
                               abbreviation: "RBC-LR", default_units: 2, display_order: 20)
      create_product("000002", name: "新鮮凍結血漿-LR「日赤」120", category: "ffp",
                               abbreviation: "FFP-LR", requires_crossmatch: false, display_order: 10)
      create_product("000003", name: "旧製剤", valid_to: Date.current - 1, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/transfusion_products"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[000002 000001 000003])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/transfusion_products", params: { item_code: "000001,000002" }
      expect(body["items"].map { |i| i["item_code"] }).to match_array(%w[000001 000002])
    end

    it "製剤区分で絞り込める" do
      get "/master/transfusion_products", params: { category: "ffp" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[000002])
    end

    it "active=true は有効期間内の製剤だけ返す" do
      get "/master/transfusion_products", params: { active: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[000002 000001])
    end

    it "名称・カナで検索できる" do
      get "/master/transfusion_products", params: { name: "赤血球" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[000001])

      get "/master/transfusion_products", params: { name: "せっけっきゅう" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[000001])
    end
  end

  describe "GET /master/transfusion_products/:id" do
    it "製剤コードでも引ける" do
      create_product("000001", name: "赤血球液-LR「日赤」2単位")

      get "/master/transfusion_products/000001"

      expect(body["name"]).to eq("赤血球液-LR「日赤」2単位")
    end
  end

  describe "POST /master/transfusion_products" do
    it "製剤コードを省略すると自動採番する" do
      create_product("000012")

      post "/master/transfusion_products", params: { name: "自動採番の製剤" }

      expect(body["item_code"]).to eq("000013")
    end

    it "ISBT128 の英字混じりコードは手入力でき、自動採番の計算には混ざらない" do
      create_product("E0382V00", name: "赤血球液-LR")

      post "/master/transfusion_products", params: { name: "自動採番の製剤" }

      expect(response).to have_http_status(:created)
      expect(body["item_code"]).to eq("000001")
    end

    it "既定は赤血球・交差適合試験ありで、単位は「単位」" do
      post "/master/transfusion_products", params: { item_code: "000001", name: "赤血球液-LR" }

      expect(body["category"]).to eq("rbc")
      expect(body["requires_crossmatch"]).to be(true)
      expect(body["unit_label"]).to eq("単位")
    end

    it "知らない製剤区分は登録できない" do
      post "/master/transfusion_products", params: { item_code: "000001", name: "製剤",
                                                     category: "unknown" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "既定単位数は正の整数だけ受け付ける" do
      post "/master/transfusion_products", params: { item_code: "000001", name: "製剤",
                                                     default_units: 0 }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/transfusion_products", params: { item_code: "000001", name: "期間おかしい",
                                                     valid_from: "2026-08-01",
                                                     valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PATCH /master/transfusion_products/:id" do
    it "製剤コードで更新できる" do
      product = create_product("000001", name: "赤血球液-LR「日赤」2単位")

      patch "/master/transfusion_products/000001", params: { name: "赤血球液-LR「日赤」4単位" }

      expect(response).to have_http_status(:ok)
      expect(product.reload.name).to eq("赤血球液-LR「日赤」4単位")
    end
  end

  describe "DELETE /master/transfusion_products/:id" do
    it "製剤コードで削除できる" do
      create_product("000001")

      delete "/master/transfusion_products/000001"

      expect(response).to have_http_status(:no_content)
      expect(Master::TransfusionProduct.count).to eq(0)
    end
  end
end
