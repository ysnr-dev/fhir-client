class CreateDashboards < ActiveRecord::Migration[8.0]
  # ダッシュボード(docs/dashboard-design.md)。データ抽出の保存した条件をタイルとして並べる。列はチャート定義と同じ。
  def change
    create_table :dashboards do |t|
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
    add_index :dashboards, :code, unique: true
    add_index :dashboards, %i[scope owner_id]
  end
end
