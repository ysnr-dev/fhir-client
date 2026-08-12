require "rails_helper"

RSpec.describe "Master::RadSetItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::RadItem.create!(item_code: "R0002", name: "頭部CTセット", kind: "set")
    Master::RadItem.create!(item_code: "R0004", name: "頭部CT単純", short_name: "頭部CT")
    Master::RadItem.create!(item_code: "R0005", name: "頭部CT造影")
  end

  describe "GET /master/rad_set_items" do
    it "構成項目の名称を添えて返す" do
      Master::RadSetItem.create!(set_item_code: "R0002", member_item_code: "R0004", display_order: 1)

      get "/master/rad_set_items", params: { set_item_code: "R0002" }

      expect(body["items"].map { |m| [m["member_item_code"], m["member_name"], m["member_short_name"]] })
        .to eq([%w[R0004 頭部CT単純 頭部CT]])
    end
  end

  describe "POST /master/rad_set_items" do
    it "追加した順に並べる" do
      post "/master/rad_set_items", params: { set_item_code: "R0002", member_item_code: "R0004" }
      post "/master/rad_set_items", params: { set_item_code: "R0002", member_item_code: "R0005" }

      expect(Master::RadSetItem.order(:display_order).pluck(:member_item_code, :display_order))
        .to eq([["R0004", 1], ["R0005", 2]])
    end

    it "同じ構成項目は二重に登録できない" do
      Master::RadSetItem.create!(set_item_code: "R0002", member_item_code: "R0004")

      post "/master/rad_set_items", params: { set_item_code: "R0002", member_item_code: "R0004" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "セット自身は構成項目にできない" do
      post "/master/rad_set_items", params: { set_item_code: "R0002", member_item_code: "R0002" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("セット自身")
    end

    it "単独オーダーの項目は構成項目にできない" do
      Master::RadItem.create!(item_code: "R0006", name: "頭部CT単純", groupable: false)

      post "/master/rad_set_items", params: { set_item_code: "R0002", member_item_code: "R0006" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("単独オーダー")
    end
  end

  describe "DELETE /master/rad_set_items/:id" do
    it "構成から外せる" do
      record = Master::RadSetItem.create!(set_item_code: "R0002", member_item_code: "R0004")

      delete "/master/rad_set_items/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::RadSetItem.count).to eq(0)
    end
  end
end
