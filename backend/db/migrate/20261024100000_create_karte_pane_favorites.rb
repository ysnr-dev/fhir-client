class CreateKartePaneFavorites < ActiveRecord::Migration[8.0]
  # カルテ右ペインの頻用メニュー(docs/features/karte.md)。医療従事者ごとに 1 つ。上流 FHIR には置かない。
  # 本人の設定なので master_ を付けない。外部キーは張らない(他と同じ方針)。
  def change
    create_table :karte_pane_favorites do |t|
      t.string :practitioner_id, null: false            # 上流 Practitioner の id
      t.jsonb :menu_keys, null: false, default: []       # 並び順どおりのメニューのキー
      t.timestamps
    end
    add_index :karte_pane_favorites, :practitioner_id, unique: true
  end
end
