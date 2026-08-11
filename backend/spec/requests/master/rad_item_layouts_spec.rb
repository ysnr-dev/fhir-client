require "rails_helper"

RSpec.describe "Master::RadItemLayouts", type: :request do
  def body
    JSON.parse(response.body)
  end

  let!(:layout) { Master::RadItemLayout.create!(name: "一般撮影", row_count: 3, column_count: 3) }

  describe "GET /master/rad_item_layouts/:id" do
    it "セルにオーダー項目の名称を添えて返す" do
      Master::RadItem.create!(item_code: "R0001", name: "胸部単純Ｘ線正面", short_name: "胸部XP")
      Master::RadItemLayoutCell.create!(layout_id: layout.id, grid_row: 1, grid_column: 1,
                                        cell_type: "label", display_name: "◆ 一般撮影")
      Master::RadItemLayoutCell.create!(layout_id: layout.id, grid_row: 2, grid_column: 1,
                                        cell_type: "item", item_code: "R0001")

      get "/master/rad_item_layouts/#{layout.id}"

      expect(body["cells"].map { |c| c["cell_type"] }).to eq(%w[label item])
      expect(body["cells"].last["item_name"]).to eq("胸部単純Ｘ線正面")
      expect(body["cells"].last["item_short_name"]).to eq("胸部XP")
    end
  end

  describe "PATCH /master/rad_item_layouts/:id" do
    it "行数・列数を縮めると範囲外のセルを片付けて件数を返す" do
      Master::RadItem.create!(item_code: "R0001", name: "胸部単純Ｘ線正面")
      Master::RadItemLayoutCell.create!(layout_id: layout.id, grid_row: 3, grid_column: 3,
                                        cell_type: "item", item_code: "R0001")
      Master::RadItemLayoutCell.create!(layout_id: layout.id, grid_row: 1, grid_column: 1,
                                        cell_type: "item", item_code: "R0001")

      patch "/master/rad_item_layouts/#{layout.id}", params: { row_count: 2, column_count: 2 }

      expect(body["removed_cells"]).to eq(1)
      expect(Master::RadItemLayoutCell.where(layout_id: layout.id).count).to eq(1)
    end

    it "1辺の上限を超える大きさにはできない" do
      patch "/master/rad_item_layouts/#{layout.id}", params: { row_count: 51 }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "DELETE /master/rad_item_layouts/:id" do
    it "ぶら下がるセルも片付ける" do
      Master::RadItemLayoutCell.create!(layout_id: layout.id, grid_row: 1, grid_column: 1,
                                        cell_type: "label", display_name: "見出し")

      delete "/master/rad_item_layouts/#{layout.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::RadItemLayoutCell.count).to eq(0)
    end
  end

  describe "POST /master/rad_item_layout_cells" do
    it "グリッドの外には置けない" do
      post "/master/rad_item_layout_cells",
           params: { layout_id: layout.id, grid_row: 4, grid_column: 1,
                     cell_type: "label", display_name: "見出し" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("行数(3)")
    end

    it "item はオーダー項目コードが要る" do
      post "/master/rad_item_layout_cells",
           params: { layout_id: layout.id, grid_row: 1, grid_column: 1, cell_type: "item" }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /master/rad_item_layout_cells/:id" do
    it "移動先にセルが居れば位置を入れ替える" do
      a = Master::RadItemLayoutCell.create!(layout_id: layout.id, grid_row: 1, grid_column: 1,
                                            cell_type: "label", display_name: "A")
      b = Master::RadItemLayoutCell.create!(layout_id: layout.id, grid_row: 2, grid_column: 2,
                                            cell_type: "label", display_name: "B")

      patch "/master/rad_item_layout_cells/#{a.id}", params: { grid_row: 2, grid_column: 2 }

      expect(response).to have_http_status(:ok)
      expect(a.reload.slice("grid_row", "grid_column").values).to eq([2, 2])
      expect(b.reload.slice("grid_row", "grid_column").values).to eq([1, 1])
    end
  end
end
