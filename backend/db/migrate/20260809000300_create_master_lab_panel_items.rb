class CreateMasterLabPanelItems < ActiveRecord::Migration[8.0]
  # パネル(1オーダー → 複数結果)の構成。master_lab_order_items.order_item_code で
  # 緩く紐づける(外部キーは張らない)。member 側もオーダー項目なので、
  # パネルの中にパネルを入れ子にできる。
  def change
    create_table :master_lab_panel_items do |t|
      t.string :panel_item_code, null: false
      t.string :member_item_code, null: false
      t.integer :display_order
      # required / optional / conditional。LOINC の R/O/C と同じ区分。
      t.string :member_type, null: false, default: "required"
      t.text :note

      t.timestamps
    end

    add_index :master_lab_panel_items, %i[panel_item_code member_item_code],
              unique: true, name: "index_lab_panel_items_on_panel_and_member"
    add_index :master_lab_panel_items, :member_item_code
  end
end
