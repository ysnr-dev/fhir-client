require "rails_helper"

RSpec.describe "Master::PhysioItemLayouts", type: :request do
  def body
    JSON.parse(response.body)
  end

  let!(:layout) { Master::PhysioItemLayout.create!(name: "生理検査 標準伝票", row_count: 3, column_count: 3) }

  describe "GET /master/physio_item_layouts/:id" do
    it "セルにオーダー項目の名称を添えて返す" do
      Master::PhysioItem.create!(item_code: "P0001", name: "心電図12誘導", short_name: "ECG12")
      Master::PhysioItemLayoutCell.create!(layout_id: layout.id, grid_row: 1, grid_column: 1,
                                           cell_type: "label", display_name: "◆ 心電図")
      Master::PhysioItemLayoutCell.create!(layout_id: layout.id, grid_row: 2, grid_column: 1,
                                           cell_type: "item", item_code: "P0001")

      get "/master/physio_item_layouts/#{layout.id}"

      expect(body["cells"].map { |c| c["cell_type"] }).to eq(%w[label item])
      expect(body["cells"].last["item_name"]).to eq("心電図12誘導")
      expect(body["cells"].last["item_short_name"]).to eq("ECG12")
    end
  end

  describe "PATCH /master/physio_item_layouts/:id" do
    it "行数・列数を縮めると範囲外のセルを片付けて件数を返す" do
      Master::PhysioItem.create!(item_code: "P0001", name: "心電図12誘導")
      Master::PhysioItemLayoutCell.create!(layout_id: layout.id, grid_row: 3, grid_column: 3,
                                           cell_type: "item", item_code: "P0001")
      Master::PhysioItemLayoutCell.create!(layout_id: layout.id, grid_row: 1, grid_column: 1,
                                           cell_type: "item", item_code: "P0001")

      patch "/master/physio_item_layouts/#{layout.id}", params: { row_count: 2, column_count: 2 }

      expect(body["removed_cells"]).to eq(1)
      expect(Master::PhysioItemLayoutCell.where(layout_id: layout.id).count).to eq(1)
    end

    it "1辺の上限を超える大きさにはできない" do
      patch "/master/physio_item_layouts/#{layout.id}", params: { row_count: 51 }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "DELETE /master/physio_item_layouts/:id" do
    it "ぶら下がるセルも片付ける" do
      Master::PhysioItemLayoutCell.create!(layout_id: layout.id, grid_row: 1, grid_column: 1,
                                           cell_type: "label", display_name: "見出し")

      delete "/master/physio_item_layouts/#{layout.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::PhysioItemLayoutCell.count).to eq(0)
    end
  end

  describe "POST /master/physio_item_layout_cells" do
    it "グリッドの外には置けない" do
      post "/master/physio_item_layout_cells",
           params: { layout_id: layout.id, grid_row: 4, grid_column: 1,
                     cell_type: "label", display_name: "見出し" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("行数(3)")
    end

    it "item はオーダー項目コードが要る" do
      post "/master/physio_item_layout_cells",
           params: { layout_id: layout.id, grid_row: 1, grid_column: 1, cell_type: "item" }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /master/physio_item_layout_cells/:id" do
    it "移動先にセルが居れば位置を入れ替える" do
      a = Master::PhysioItemLayoutCell.create!(layout_id: layout.id, grid_row: 1, grid_column: 1,
                                               cell_type: "label", display_name: "A")
      b = Master::PhysioItemLayoutCell.create!(layout_id: layout.id, grid_row: 2, grid_column: 2,
                                               cell_type: "label", display_name: "B")

      patch "/master/physio_item_layout_cells/#{a.id}", params: { grid_row: 2, grid_column: 2 }

      expect(response).to have_http_status(:ok)
      expect(a.reload.slice("grid_row", "grid_column").values).to eq([2, 2])
      expect(b.reload.slice("grid_row", "grid_column").values).to eq([1, 1])
    end
  end
end
