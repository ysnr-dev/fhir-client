class CreateMasterSchemas < ActiveRecord::Migration[8.0]
  # シェーマ台紙のマスタ。画像は report_layouts.tlf と同様に backend DB の
  # text カラムへ dataURL 文字列で保存する(上流 FHIR に依存せず単一リクエストで
  # 登録が完結する)。一覧・選択グリッドは image を読まずに済むよう、縮小版の
  # thumbnail を別カラムで持つ。
  def change
    create_table :master_schemas do |t|
      t.string :name, null: false
      t.bigint :category_id     # master_schema_categories の id。NULL は未分類
      t.text :image, null: false     # 台紙本体(dataURL。登録時に長辺1600pxへ正規化済み)
      t.text :thumbnail, null: false # 一覧・選択グリッド用の縮小版(dataURL、長辺160px)
      t.integer :display_order  # 同じカテゴリの中での表示順
      t.text :note
      t.timestamps
    end
    add_index :master_schemas, :category_id
  end
end
