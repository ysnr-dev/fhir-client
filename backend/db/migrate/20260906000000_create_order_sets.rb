class CreateOrderSets < ActiveRecord::Migration[8.0]
  # オーダーセット(よく出すオーダーのひとまとめ)。フォルダとセットを parent_id の
  # 隣接リストで任意の深さに積む(master_schema_categories と同じ形)。
  # 持ち主は 3 段階(scope): 院内共通 / 診療科 / 医師。owner_id は上流 FHIR の
  # Organization.id / Practitioner.id をそのまま文字列で持ち、表示名は非正規化する
  # (master_surgery_room_blocks の department_code / department_name と同じ考え)。
  # 外部キーは張らず、整合性はアプリ側の削除ガードで守る(他マスタと同じ方針)。
  def change
    create_table :order_sets do |t|
      t.string :code, null: false      # uuid。環境間の移送とオーダーへ焼く印に使う
      t.string :kind, null: false      # "folder" | "set"
      t.bigint :parent_id              # 親フォルダ。NULL はそのスコープのルート直下
      t.string :scope, null: false     # "facility" | "department" | "practitioner"
      t.string :owner_id               # 診療科 Organization.id / Practitioner.id。facility は NULL
      t.string :owner_name             # 表示用(上流を引き直さない)
      t.string :name, null: false
      t.integer :display_order         # 同じ親の中での表示順
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :order_sets, :code, unique: true
    add_index :order_sets, %i[scope owner_id parent_id]
    add_index :order_sets, :parent_id
  end
end
