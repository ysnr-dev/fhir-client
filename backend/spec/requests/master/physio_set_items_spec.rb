require "rails_helper"

RSpec.describe "Master::PhysioSetItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::PhysioItem.create!(item_code: "P0002", name: "心肺機能セット", kind: "set")
    Master::PhysioItem.create!(item_code: "P0004", name: "心電図12誘導", short_name: "ECG12",
                               exam_type_code: "01")
    Master::PhysioItem.create!(item_code: "P0005", name: "呼吸機能検査")
  end

  describe "GET /master/physio_set_items" do
    it "構成項目の名称と検査種別を添えて返す" do
      Master::PhysioSetItem.create!(set_item_code: "P0002", member_item_code: "P0004", display_order: 1)

      get "/master/physio_set_items", params: { set_item_code: "P0002" }

      expect(body["items"].map { |m| m.values_at("member_item_code", "member_name", "member_short_name", "member_exam_type_code") })
        .to eq([%w[P0004 心電図12誘導 ECG12 01]])
    end
  end

  describe "POST /master/physio_set_items" do
    it "追加した順に並べる" do
      post "/master/physio_set_items", params: { set_item_code: "P0002", member_item_code: "P0004" }
      post "/master/physio_set_items", params: { set_item_code: "P0002", member_item_code: "P0005" }

      expect(Master::PhysioSetItem.order(:display_order).pluck(:member_item_code, :display_order))
        .to eq([["P0004", 1], ["P0005", 2]])
    end

    it "同じ構成項目は二重に登録できない" do
      Master::PhysioSetItem.create!(set_item_code: "P0002", member_item_code: "P0004")

      post "/master/physio_set_items", params: { set_item_code: "P0002", member_item_code: "P0004" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "セット自身は構成項目にできない" do
      post "/master/physio_set_items", params: { set_item_code: "P0002", member_item_code: "P0002" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("セット自身")
    end

    it "単独オーダーの項目は構成項目にできない" do
      Master::PhysioItem.create!(item_code: "P0006", name: "腹部超音波", groupable: false)

      post "/master/physio_set_items", params: { set_item_code: "P0002", member_item_code: "P0006" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("単独オーダー")
    end
  end

  describe "DELETE /master/physio_set_items/:id" do
    it "構成から外せる" do
      record = Master::PhysioSetItem.create!(set_item_code: "P0002", member_item_code: "P0004")

      delete "/master/physio_set_items/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::PhysioSetItem.count).to eq(0)
    end
  end
end
