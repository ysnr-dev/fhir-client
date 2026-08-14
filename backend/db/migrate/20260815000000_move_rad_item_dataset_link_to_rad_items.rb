class MoveRadItemDatasetLinkToRadItems < ActiveRecord::Migration[8.0]
  # 撮影項目 ↔ 実施入力用データセットの紐付けを、中間表から撮影項目の1列へ畳む。
  #
  # 多対多にしていたのは「手技セット × 造影剤セット × 器材セット」を軸ごとに
  # 組み合わせたかったためだが、データセットは detail_type で3種を1つに持てるので
  # 組み合わせの必要が薄く、実施入力側では同一コードの明細が先勝ちで潰れる
  # (どのデータセット由来かも画面に出ない)曖昧さだけが残っていた。
  #
  # 1項目1データセットにしても、1つのデータセットを複数の撮影項目から参照できる点は
  # 変わらないので、共通セットの使い回しはそのまま続けられる。
  def up
    add_column :master_rad_items, :dataset_code, :string
    add_index :master_rad_items, :dataset_code

    # 複数紐付いていた項目は、表示順(なければ登録順)の先頭だけを残す。
    execute(<<~SQL.squish)
      UPDATE master_rad_items
         SET dataset_code = link.dataset_code
        FROM (
          SELECT DISTINCT ON (item_code) item_code, dataset_code
            FROM master_rad_item_datasets
           ORDER BY item_code, display_order NULLS LAST, id
        ) AS link
       WHERE master_rad_items.item_code = link.item_code
    SQL

    drop_table :master_rad_item_datasets
  end

  def down
    create_table :master_rad_item_datasets do |t|
      t.string :item_code, null: false
      t.string :dataset_code, null: false
      t.integer :display_order

      t.timestamps
    end

    add_index :master_rad_item_datasets, %i[item_code dataset_code],
              unique: true, name: "index_rad_item_datasets_on_item_and_dataset"
    add_index :master_rad_item_datasets, :dataset_code

    execute(<<~SQL.squish)
      INSERT INTO master_rad_item_datasets (item_code, dataset_code, created_at, updated_at)
      SELECT item_code, dataset_code, NOW(), NOW()
        FROM master_rad_items
       WHERE dataset_code IS NOT NULL
    SQL

    remove_column :master_rad_items, :dataset_code
  end
end
