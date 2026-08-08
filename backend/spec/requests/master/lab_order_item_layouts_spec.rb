require "rails_helper"

RSpec.describe "Master::LabOrderItemLayouts", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_layout(overrides = {})
    Master::LabOrderItemLayout.create!(
      { name: "外来用", row_count: 5, column_count: 4 }.merge(overrides)
    )
  end

  def create_item_cell(layout, row, column, overrides = {})
    Master::LabOrderItemLayoutCell.create!(
      { layout_id: layout.id, grid_row: row, grid_column: column,
        cell_type: "item", order_item_code: "L0001" }.merge(overrides)
    )
  end

  before do
    Master::LabOrderItem.create!(order_item_code: "L0001", name: "総蛋白(TP)", short_name: "TP")
  end

  describe "レイアウト" do
    it "作成して一覧・詳細を引ける" do
      post "/master/lab_order_item_layouts", params: {
        name: "外来用", row_count: 8, column_count: 6,
      }, as: :json
      expect(response).to have_http_status(:created)
      id = body["id"]

      get "/master/lab_order_item_layouts"
      expect(body["items"].map { |l| l["name"] }).to eq(["外来用"])

      get "/master/lab_order_item_layouts/#{id}"
      expect(body["row_count"]).to eq(8)
      expect(body["cells"]).to eq([])
    end

    it "同じ名前は二重登録できない" do
      create_layout

      post "/master/lab_order_item_layouts", params: { name: "外来用" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "行数・列数は1以上に限る" do
      post "/master/lab_order_item_layouts", params: {
        name: "外来用", row_count: 0, column_count: 4,
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "縮めたときは範囲外のセルを片付けて件数を返す" do
      layout = create_layout(row_count: 5, column_count: 4)
      create_item_cell(layout, 1, 1)
      create_item_cell(layout, 5, 4)

      patch "/master/lab_order_item_layouts/#{layout.id}", params: {
        row_count: 3, column_count: 3,
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(body["removed_cells"]).to eq(1)
      expect(Master::LabOrderItemLayoutCell.where(layout_id: layout.id).count).to eq(1)
    end

    it "消すとぶら下がるセルも消える" do
      layout = create_layout
      create_item_cell(layout, 1, 1)

      delete "/master/lab_order_item_layouts/#{layout.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::LabOrderItemLayoutCell.count).to eq(0)
    end

    it "詳細のセルにはオーダー項目の名称を添える" do
      layout = create_layout
      create_item_cell(layout, 2, 3)

      get "/master/lab_order_item_layouts/#{layout.id}"

      cell = body["cells"].first
      expect(cell["grid_row"]).to eq(2)
      expect(cell["item_name"]).to eq("総蛋白(TP)")
      expect(cell["item_short_name"]).to eq("TP")
    end
  end

  describe "セル" do
    let(:layout) { create_layout }

    it "検査項目のセルを置ける" do
      post "/master/lab_order_item_layout_cells", params: {
        layout_id: layout.id, grid_row: 1, grid_column: 2,
        cell_type: "item", order_item_code: "L0001",
      }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["cell_type"]).to eq("item")
    end

    it "ラベルのセルを置ける" do
      post "/master/lab_order_item_layout_cells", params: {
        layout_id: layout.id, grid_row: 1, grid_column: 1,
        cell_type: "label", display_name: "◆ 生化学",
      }, as: :json

      expect(response).to have_http_status(:created)
    end

    it "検査項目のセルにはコードが要る" do
      post "/master/lab_order_item_layout_cells", params: {
        layout_id: layout.id, grid_row: 1, grid_column: 1, cell_type: "item",
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "ラベルのセルには文言が要る" do
      post "/master/lab_order_item_layout_cells", params: {
        layout_id: layout.id, grid_row: 1, grid_column: 1, cell_type: "label",
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "同じマスには二重に置けない" do
      create_item_cell(layout, 1, 1)

      post "/master/lab_order_item_layout_cells", params: {
        layout_id: layout.id, grid_row: 1, grid_column: 1,
        cell_type: "label", display_name: "重複",
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "グリッドの外には置けない" do
      post "/master/lab_order_item_layout_cells", params: {
        layout_id: layout.id, grid_row: 6, grid_column: 1,
        cell_type: "label", display_name: "はみ出し",
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "空きマスへ移動できる" do
      cell = create_item_cell(layout, 1, 1)

      patch "/master/lab_order_item_layout_cells/#{cell.id}", params: {
        grid_row: 3, grid_column: 2,
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(cell.reload.grid_row).to eq(3)
    end

    it "別のセルが居るマスへ動かすと位置が入れ替わる" do
      moving = create_item_cell(layout, 1, 1)
      occupant = Master::LabOrderItemLayoutCell.create!(
        layout_id: layout.id, grid_row: 2, grid_column: 2,
        cell_type: "label", display_name: "◆ 血算"
      )

      patch "/master/lab_order_item_layout_cells/#{moving.id}", params: {
        grid_row: 2, grid_column: 2,
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(moving.reload.attributes.values_at("grid_row", "grid_column")).to eq([2, 2])
      expect(occupant.reload.attributes.values_at("grid_row", "grid_column")).to eq([1, 1])
    end

    it "表示名を上書きして消せる" do
      cell = create_item_cell(layout, 1, 1)

      patch "/master/lab_order_item_layout_cells/#{cell.id}", params: {
        display_name: "TP(伝票用)",
      }, as: :json
      expect(body["display_name"]).to eq("TP(伝票用)")

      delete "/master/lab_order_item_layout_cells/#{cell.id}"
      expect(response).to have_http_status(:no_content)
    end
  end
end
