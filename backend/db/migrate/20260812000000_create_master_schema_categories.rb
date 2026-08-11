class CreateMasterSchemaCategories < ActiveRecord::Migration[8.0]
  # シェーマ(診療記録に描き込む台紙画像)のカテゴリ。部位・診療科など任意の
  # 深さの階層で分類できるよう、隣接リスト(parent_id)で持つ。他マスタと同じく
  # 外部キーは張らず、整合性はアプリ側の削除ガードで守る。
  def change
    create_table :master_schema_categories do |t|
      t.string :name, null: false
      t.bigint :parent_id       # 親カテゴリの id。NULL はルート(最上位)
      t.integer :display_order  # 同じ親の中での表示順
      t.timestamps
    end
    add_index :master_schema_categories, :parent_id
  end
end
