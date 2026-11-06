class CreateFavoriteConditions < ActiveRecord::Migration[8.0]
  # 頻用病名(docs/features/patient-profile.md「頻用病名」)。病名+修飾語の組み合わせを持ち主ごとに持つ。列は診療ダッシュボードと同じ。
  def change
    create_table :favorite_conditions do |t|
      t.string :code, null: false
      t.string :scope, null: false
      t.string :owner_id
      t.string :owner_name
      t.string :name, null: false
      t.jsonb :definition, null: false, default: {}
      t.integer :display_order
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :favorite_conditions, :code, unique: true
    add_index :favorite_conditions, %i[scope owner_id]
  end
end
