require "rails_helper"

RSpec.describe "Master::LabPanelItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::LabOrderItem.create!(order_item_code: "P0001", name: "末梢血液一般検査", kind: "panel")
    Master::LabOrderItem.create!(order_item_code: "L0001", name: "白血球数")
    Master::LabOrderItem.create!(order_item_code: "L0002", name: "赤血球数")
  end

  it "パネルの構成を並び順で引ける" do
    Master::LabPanelItem.create!(panel_item_code: "P0001", member_item_code: "L0002", display_order: 2)
    Master::LabPanelItem.create!(panel_item_code: "P0001", member_item_code: "L0001", display_order: 1)

    get "/master/lab_panel_items", params: { panel_item_code: "P0001" }

    expect(body["items"].map { |m| m["member_item_code"] }).to eq(%w[L0001 L0002])
  end

  it "追加時に並び順を採番し、二重追加・自己参照は登録できない" do
    post "/master/lab_panel_items", params: {
      panel_item_code: "P0001", member_item_code: "L0001",
    }, as: :json
    expect(response).to have_http_status(:created)
    expect(body["display_order"]).to eq(1)

    post "/master/lab_panel_items", params: {
      panel_item_code: "P0001", member_item_code: "L0002",
    }, as: :json
    expect(body["display_order"]).to eq(2)

    post "/master/lab_panel_items", params: {
      panel_item_code: "P0001", member_item_code: "L0001",
    }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/lab_panel_items", params: {
      panel_item_code: "P0001", member_item_code: "P0001",
    }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "更新・削除できる" do
    member = Master::LabPanelItem.create!(panel_item_code: "P0001", member_item_code: "L0001")

    patch "/master/lab_panel_items/#{member.id}", params: { member_type: "optional" }, as: :json
    expect(body["member_type"]).to eq("optional")

    delete "/master/lab_panel_items/#{member.id}"
    expect(response).to have_http_status(:no_content)
  end
end
