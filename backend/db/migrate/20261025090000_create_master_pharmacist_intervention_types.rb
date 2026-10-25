class CreateMasterPharmacistInterventionTypes < ActiveRecord::Migration[8.0]
  # 処方監査の介入種別のマスタ(docs/rx-verification-design.md §4.1)。
  def change
    create_table :master_pharmacist_intervention_types do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.boolean :enabled, null: false, default: true
      t.integer :display_order
      t.timestamps
    end
    add_index :master_pharmacist_intervention_types, :code, unique: true
  end
end
