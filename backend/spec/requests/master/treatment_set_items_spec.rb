require "rails_helper"

RSpec.describe "Master::TreatmentSetItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::TreatmentItem.create!(item_code: "T0002", name: "褥瘡処置セット", kind: "set")
    Master::TreatmentItem.create!(item_code: "T0004", name: "創傷処置", short_name: "創処置")
    Master::TreatmentItem.create!(item_code: "T0005", name: "皮膚科軟膏処置")
  end

  describe "GET /master/treatment_set_items" do
    it "構成項目の名称を添えて返す" do
      Master::TreatmentSetItem.create!(set_item_code: "T0002", member_item_code: "T0004", display_order: 1)

      get "/master/treatment_set_items", params: { set_item_code: "T0002" }

      expect(body["items"].map { |m| m.values_at("member_item_code", "member_name", "member_short_name") })
        .to eq([%w[T0004 創傷処置 創処置]])
    end
  end

  describe "POST /master/treatment_set_items" do
    it "追加した順に並べる" do
      post "/master/treatment_set_items", params: { set_item_code: "T0002", member_item_code: "T0004" }
      post "/master/treatment_set_items", params: { set_item_code: "T0002", member_item_code: "T0005" }

      expect(Master::TreatmentSetItem.order(:display_order).pluck(:member_item_code, :display_order))
        .to eq([["T0004", 1], ["T0005", 2]])
    end

    it "同じ構成項目は二重に登録できない" do
      Master::TreatmentSetItem.create!(set_item_code: "T0002", member_item_code: "T0004")

      post "/master/treatment_set_items", params: { set_item_code: "T0002", member_item_code: "T0004" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "セット自身は構成項目にできない" do
      post "/master/treatment_set_items", params: { set_item_code: "T0002", member_item_code: "T0002" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("セット自身")
    end

    it "単独オーダーの項目は構成項目にできない" do
      Master::TreatmentItem.create!(item_code: "T0006", name: "中心静脈カテーテル挿入", groupable: false)

      post "/master/treatment_set_items", params: { set_item_code: "T0002", member_item_code: "T0006" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("単独オーダー")
    end
  end

  describe "DELETE /master/treatment_set_items/:id" do
    it "構成から外せる" do
      record = Master::TreatmentSetItem.create!(set_item_code: "T0002", member_item_code: "T0004")

      delete "/master/treatment_set_items/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::TreatmentSetItem.count).to eq(0)
    end
  end
end
