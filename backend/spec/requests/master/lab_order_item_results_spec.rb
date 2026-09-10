require "rails_helper"

RSpec.describe "Master::LabOrderItemResults", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::LabOrderItem.create!(order_item_code: "O0001", name: "血液ガス分析")
    Master::LabSpecimen.create!(specimen_code: "223", name: "全血(動脈血)")
    Master::LabResultItem.create!(result_item_code: "R0001", name: "血液ガス pH", data_type: "PQ", specimen_code: "223")
    Master::LabResultItem.create!(result_item_code: "R0002", name: "血液ガス PCO2", display_unit: "mmHg")
  end

  it "オーダー項目の対応を並び順で引き、結果項目を入れ子で添える" do
    Master::LabOrderItemResult.create!(order_item_code: "O0001", result_item_code: "R0002", display_order: 2)
    Master::LabOrderItemResult.create!(order_item_code: "O0001", result_item_code: "R0001", display_order: 1)

    get "/master/lab_order_item_results", params: { order_item_code: "O0001" }

    expect(body["items"].map { |m| m["result_item_code"] }).to eq(%w[R0001 R0002])
    expect(body["items"].map { |m| m["result_item"]["name"] }).to eq(["血液ガス pH", "血液ガス PCO2"])
    expect(body["items"].last["result_item"]["display_unit"]).to eq("mmHg")
    # 材料名も入れ子で添える(結果登録画面の「材料」列と Specimen の表示名に使う)。
    expect(body["items"].first["result_item"]["specimen_name"]).to eq("全血(動脈血)")
  end

  it "オーダー項目コードのカンマ区切りで複数項目の対応をまとめて引ける" do
    Master::LabOrderItem.create!(order_item_code: "O0002", name: "CRP")
    Master::LabOrderItemResult.create!(order_item_code: "O0001", result_item_code: "R0001")
    Master::LabOrderItemResult.create!(order_item_code: "O0002", result_item_code: "R0002")

    get "/master/lab_order_item_results", params: { order_item_code: "O0001,O0002" }

    expect(body["items"].map { |m| m["result_item_code"] }).to match_array(%w[R0001 R0002])
  end

  it "結果項目がマスタから消えていても対応は返る(result_item は null)" do
    Master::LabOrderItemResult.create!(order_item_code: "O0001", result_item_code: "R9999")

    get "/master/lab_order_item_results", params: { order_item_code: "O0001" }

    expect(body["items"].first["result_item"]).to be_nil
  end

  it "追加時に並び順を採番し、二重追加は登録できない" do
    post "/master/lab_order_item_results", params: {
      order_item_code: "O0001", result_item_code: "R0001",
    }, as: :json
    expect(response).to have_http_status(:created)
    expect(body["display_order"]).to eq(1)

    post "/master/lab_order_item_results", params: {
      order_item_code: "O0001", result_item_code: "R0002",
    }, as: :json
    expect(body["display_order"]).to eq(2)

    post "/master/lab_order_item_results", params: {
      order_item_code: "O0001", result_item_code: "R0001",
    }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  describe "expand_panels=true" do
    before do
      # セット(SET) → パネル(P0001) → 単項目(O0002 / O0003) の入れ子。
      Master::LabOrderItem.create!(order_item_code: "SET", name: "生化学セット", kind: "panel")
      Master::LabOrderItem.create!(order_item_code: "P0001", name: "ナトリウム及びクロール", kind: "panel")
      Master::LabOrderItem.create!(order_item_code: "O0002", name: "ナトリウム")
      Master::LabOrderItem.create!(order_item_code: "O0003", name: "クロール")
      Master::LabResultItem.create!(result_item_code: "R0003", name: "ナトリウム(Na)")
      Master::LabResultItem.create!(result_item_code: "R0004", name: "クロール(Cl)")
      Master::LabPanelItem.create!(panel_item_code: "SET", member_item_code: "P0001", display_order: 1)
      Master::LabPanelItem.create!(panel_item_code: "P0001", member_item_code: "O0003", display_order: 2)
      Master::LabPanelItem.create!(panel_item_code: "P0001", member_item_code: "O0002", display_order: 1)
      Master::LabOrderItemResult.create!(order_item_code: "O0002", result_item_code: "R0003")
      Master::LabOrderItemResult.create!(order_item_code: "O0003", result_item_code: "R0004")
    end

    it "パネルをたどって結果項目まで解決し、要求元のコードを添える" do
      get "/master/lab_order_item_results", params: { order_item_code: "P0001", expand_panels: "true" }

      expect(body["items"].map { |m| m["result_item"]["name"] }).to eq(["ナトリウム(Na)", "クロール(Cl)"])
      expect(body["items"].map { |m| m["requested_order_item_code"] }).to eq(%w[P0001 P0001])
    end

    it "セットの中のパネルも解決する(入れ子の深さを問わない)" do
      get "/master/lab_order_item_results", params: { order_item_code: "SET", expand_panels: "true" }

      expect(body["items"].map { |m| m["result_item_code"] }).to eq(%w[R0003 R0004])
    end

    it "自分の対応表がある項目はパネルをたどらない" do
      Master::LabOrderItemResult.create!(order_item_code: "P0001", result_item_code: "R0001")

      get "/master/lab_order_item_results", params: { order_item_code: "P0001", expand_panels: "true" }

      expect(body["items"].map { |m| m["result_item_code"] }).to eq(%w[R0001])
    end

    it "対応表もパネル構成も無い項目は行を返さない" do
      Master::LabOrderItem.create!(order_item_code: "O0009", name: "対応なし")

      get "/master/lab_order_item_results", params: { order_item_code: "O0009,O0002", expand_panels: "true" }

      expect(body["items"].map { |m| m["requested_order_item_code"] }).to eq(%w[O0002])
    end

    it "パネルが循環していても止まる" do
      Master::LabPanelItem.create!(panel_item_code: "P0001", member_item_code: "SET", display_order: 3)

      get "/master/lab_order_item_results", params: { order_item_code: "SET", expand_panels: "true" }

      expect(response).to have_http_status(:ok)
      expect(body["items"].map { |m| m["result_item_code"] }).to eq(%w[R0003 R0004])
    end
  end

  it "更新・削除できる" do
    mapping = Master::LabOrderItemResult.create!(order_item_code: "O0001", result_item_code: "R0001")

    patch "/master/lab_order_item_results/#{mapping.id}", params: { display_order: 5 }, as: :json
    expect(body["display_order"]).to eq(5)

    delete "/master/lab_order_item_results/#{mapping.id}"
    expect(response).to have_http_status(:no_content)
  end
end
