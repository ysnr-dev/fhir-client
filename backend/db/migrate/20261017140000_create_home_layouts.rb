class CreateHomeLayouts < ActiveRecord::Migration[8.0]
  # ホームのカードの並び(docs/features/home.md)。医療従事者ごとに 1 つ。上流 FHIR には置かない。
  # 本人の設定なので master_ を付けない。外部キーは張らない(他と同じ方針)。
  def change
    create_table :home_layouts do |t|
      t.string :practitioner_id, null: false            # 上流 Practitioner の id
      t.jsonb :definition, null: false, default: {}
      t.timestamps
    end
    add_index :home_layouts, :practitioner_id, unique: true
  end
end
