class CreateMasterAdvisoryRules < ActiveRecord::Migration[8.0]
  # 施設が条件式で定義する警告の規則(docs/advisory-design.md §3.6)。
  def change
    create_table :master_advisory_rules do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.boolean :enabled, null: false, default: true
      t.integer :display_order
      t.string :severity, null: false, default: "info"
      t.jsonb :contexts, null: false, default: []
      t.text :expression, null: false
      t.string :message, null: false
      t.text :detail
      t.string :basis
      t.timestamps
    end
    add_index :master_advisory_rules, :code, unique: true
  end
end
