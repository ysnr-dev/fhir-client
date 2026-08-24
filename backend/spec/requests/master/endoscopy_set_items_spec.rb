require "rails_helper"

RSpec.describe "Master::EndoscopySetItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::EndoscopyItem.create!(item_code: "P0002", name: "胃・大腸セット", kind: "set")
    Master::EndoscopyItem.create!(item_code: "P0004", name: "上部消化管内視鏡(経口)", short_name: "EGD",
                               exam_type_code: "01")
    Master::EndoscopyItem.create!(item_code: "P0005", name: "気管支鏡")
  end

  describe "GET /master/endoscopy_set_items" do
    it "構成項目の名称と検査種別を添えて返す" do
      Master::EndoscopySetItem.create!(set_item_code: "P0002", member_item_code: "P0004", display_order: 1)

      get "/master/endoscopy_set_items", params: { set_item_code: "P0002" }

      expect(body["items"].map { |m| m.values_at("member_item_code", "member_name", "member_short_name", "member_exam_type_code") })
        .to eq([%w[P0004 上部消化管内視鏡(経口) EGD 01]])
    end
  end

  describe "POST /master/endoscopy_set_items" do
    it "追加した順に並べる" do
      post "/master/endoscopy_set_items", params: { set_item_code: "P0002", member_item_code: "P0004" }
      post "/master/endoscopy_set_items", params: { set_item_code: "P0002", member_item_code: "P0005" }

      expect(Master::EndoscopySetItem.order(:display_order).pluck(:member_item_code, :display_order))
        .to eq([["P0004", 1], ["P0005", 2]])
    end

    it "同じ構成項目は二重に登録できない" do
      Master::EndoscopySetItem.create!(set_item_code: "P0002", member_item_code: "P0004")

      post "/master/endoscopy_set_items", params: { set_item_code: "P0002", member_item_code: "P0004" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "セット自身は構成項目にできない" do
      post "/master/endoscopy_set_items", params: { set_item_code: "P0002", member_item_code: "P0002" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("セット自身")
    end

    it "単独オーダーの項目は構成項目にできない" do
      Master::EndoscopyItem.create!(item_code: "P0006", name: "大腸内視鏡", groupable: false)

      post "/master/endoscopy_set_items", params: { set_item_code: "P0002", member_item_code: "P0006" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("単独オーダー")
    end
  end

  describe "DELETE /master/endoscopy_set_items/:id" do
    it "構成から外せる" do
      record = Master::EndoscopySetItem.create!(set_item_code: "P0002", member_item_code: "P0004")

      delete "/master/endoscopy_set_items/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::EndoscopySetItem.count).to eq(0)
    end
  end
end
