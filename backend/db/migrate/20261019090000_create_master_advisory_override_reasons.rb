class CreateMasterAdvisoryOverrideReasons < ActiveRecord::Migration[8.0]
  # 警告(判断支援)を無視して登録するときに選ぶ理由のマスタ(docs/advisory-design.md §3.1)。
  def change
    create_table :master_advisory_override_reasons do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.boolean :enabled, null: false, default: true
      t.integer :display_order
      t.timestamps
    end
    add_index :master_advisory_override_reasons, :code, unique: true
  end
end
