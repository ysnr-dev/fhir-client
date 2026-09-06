class CreateOrderSetEntries < ActiveRecord::Migration[8.0]
  # セット 1 件に含まれるオーダー 1 件ぶん。中身はフロントのオーダー登録フォームの
  # 入力値(PrescriptionFormValues など)をそのまま jsonb に入れる。backend は中身を
  # 解釈しない(フォーム値の形が変わったら schema_version を上げてフロントで移行する)。
  def change
    create_table :order_set_entries do |t|
      t.bigint :order_set_id, null: false
      t.integer :display_order
      t.string :order_type, null: false          # "prescription" / "lab-order" など(KartePaneState の接頭辞)
      t.string :label                            # 一覧に出す要約。保存時にフロントが作る
      t.jsonb :values, null: false, default: {}
      t.integer :schema_version, null: false, default: 1
      t.timestamps
    end
    add_index :order_set_entries, %i[order_set_id display_order]
  end
end
