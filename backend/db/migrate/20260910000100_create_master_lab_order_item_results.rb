class CreateMasterLabOrderItemResults < ActiveRecord::Migration[8.0]
  # オーダー項目 → 結果項目の対応(1:N)。結果登録画面がオーダーの検査項目を
  # 結果の行に展開するときに引く。master_lab_order_items.order_item_code と
  # master_lab_result_items.result_item_code で緩く紐づける(外部キーは張らない)。
  #
  # パネル構成(master_lab_panel_items = パネル → 構成オーダー項目)とは別の関係。
  # 血液像のようにパネルではない単項目が複数の結果を返す場合をここで表す。
  def change
    create_table :master_lab_order_item_results do |t|
      t.string :order_item_code, null: false
      t.string :result_item_code, null: false
      t.integer :display_order
      t.text :note

      t.timestamps
    end

    add_index :master_lab_order_item_results, %i[order_item_code result_item_code],
              unique: true, name: "index_lab_order_item_results_on_order_and_result"
    add_index :master_lab_order_item_results, :result_item_code
  end
end
