class CreateMasterLineDrainTypes < ActiveRecord::Migration[8.0]
  # ライン・ドレーン・カテーテルの種別マスタ(docs/line-drain-design.md §3)。
  def change
    create_table :master_line_drain_types do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.string :kind, null: false
      t.integer :warn_days
      t.boolean :enabled, null: false, default: true
      t.integer :display_order
      t.timestamps
    end
    add_index :master_line_drain_types, :code, unique: true
  end
end
