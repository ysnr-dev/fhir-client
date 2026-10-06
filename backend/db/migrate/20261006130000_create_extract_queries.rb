class CreateExtractQueries < ActiveRecord::Migration[8.0]
  # データ抽出の条件(docs/data-extract-design.md)。列はチャート定義と同じ。
  def change
    create_table :extract_queries do |t|
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
    add_index :extract_queries, :code, unique: true
    add_index :extract_queries, %i[scope owner_id]
  end
end
