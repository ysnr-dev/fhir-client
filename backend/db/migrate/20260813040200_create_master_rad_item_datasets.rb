class CreateMasterRadItemDatasets < ActiveRecord::Migration[8.0]
  # 撮影項目マスタ(master_rad_items)と実施入力用データセットの紐付け。
  #
  # 多対多にしているのは、1つの撮影項目に「造影剤セット」と「穿刺器材セット」の
  # ように性質の違うデータセットを併せて付けたいことがあり、逆に1つの
  # データセットは複数の撮影項目から使い回されるため。実施入力では、オーダーに
  # 載っている全撮影項目に紐付く全データセットの明細をマージして初期表示する。
  #
  # 他のマスタ間の紐付け(master_rad_set_items)と同じく FK は張らずコードで持つ。
  def change
    create_table :master_rad_item_datasets do |t|
      t.string :item_code, null: false     # master_rad_items.item_code
      t.string :dataset_code, null: false  # master_rad_datasets.dataset_code
      t.integer :display_order

      t.timestamps
    end

    add_index :master_rad_item_datasets, %i[item_code dataset_code],
              unique: true, name: "index_rad_item_datasets_on_item_and_dataset"
    add_index :master_rad_item_datasets, :dataset_code
  end
end
