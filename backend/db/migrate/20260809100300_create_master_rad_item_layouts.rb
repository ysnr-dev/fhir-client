class CreateMasterRadItemLayouts < ActiveRecord::Migration[8.0]
  # 放射線オーダー画面の項目配置。検体検査の master_lab_order_item_layouts と
  # 同じ作りで、グリッドに放射線オーダー項目とラベル(表示専用セル)を自由に置く。
  # レイアウト(グリッドの大きさ)とセル(1マスの中身)の2階建て。
  def change
    create_table :master_rad_item_layouts do |t|
      t.string :name, null: false          # レイアウト名(一般撮影・CT など)
      t.integer :row_count, null: false, default: 10
      t.integer :column_count, null: false, default: 5
      t.integer :display_order
      t.boolean :active, null: false, default: true
      t.text :note
      t.timestamps
    end

    create_table :master_rad_item_layout_cells do |t|
      # 親レイアウト。配布ファイルの取込で洗い替えされる他マスタと違い、
      # レイアウトは画面編集専用で id が変わらないため id で参照する
      # (DB の外部キー制約は他マスタと同様に張らない)。
      t.integer :layout_id, null: false
      # 位置(1始まり)。row / column は PostgreSQL の予約語で生SQLに書けないため
      # grid_ を付けている。
      t.integer :grid_row, null: false
      t.integer :grid_column, null: false
      # item = 放射線オーダー項目 / label = 表示専用の文言
      t.string :cell_type, null: false, default: "item"
      # cell_type=item のとき master_rad_items.item_code。
      t.string :item_code
      # item: 伝票上の表示名(空ならオーダー項目の表示名をそのまま使う) / label: 表示文言
      t.string :display_name
      t.timestamps
    end

    add_index :master_rad_item_layouts, :name, unique: true
    add_index :master_rad_item_layout_cells, %i[layout_id grid_row grid_column],
              unique: true, name: "index_rad_layout_cells_on_layout_and_position"
    add_index :master_rad_item_layout_cells, :item_code
  end
end
