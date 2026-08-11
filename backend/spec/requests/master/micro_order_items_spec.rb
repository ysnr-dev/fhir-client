require "rails_helper"

RSpec.describe "Master::MicroOrderItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/micro_order_items" do
    let!(:smear) do
      Master::MicroOrderItem.create!(item_code: "1", name: "塗抹・鏡検", short_name: "塗抹",
                                     display_order: 10)
    end
    let!(:retired) do
      Master::MicroOrderItem.create!(item_code: "9", name: "廃止した項目",
                                     valid_to: Date.current - 1, display_order: 20)
    end

    it "掲載順で返す" do
      get "/master/micro_order_items"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[1 9])
    end

    it "active=true は有効期間内の項目だけ返す" do
      get "/master/micro_order_items", params: { active: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq([smear.item_code])
    end

    it "名称で検索できる" do
      get "/master/micro_order_items", params: { name: "塗抹" }
      expect(body["items"].map { |i| i["item_code"] }).to eq([smear.item_code])
    end
  end

  describe "CRUD" do
    it "作成・更新・削除できる(項目コードは変更不可)" do
      post "/master/micro_order_items",
           params: { item_code: "10", name: "定量培養", display_order: 100 }, as: :json
      expect(response).to have_http_status(:created)
      id = body["id"]

      patch "/master/micro_order_items/#{id}",
            params: { item_code: "99", name: "尿定量培養" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(Master::MicroOrderItem.find(id)).to have_attributes(item_code: "10", name: "尿定量培養")

      delete "/master/micro_order_items/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "有効終了日が開始日より前ならエラー" do
      post "/master/micro_order_items",
           params: { item_code: "10", name: "定量培養",
                     valid_from: "2026-08-10", valid_to: "2026-08-01" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
