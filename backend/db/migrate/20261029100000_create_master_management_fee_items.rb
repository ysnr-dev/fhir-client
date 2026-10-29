class CreateMasterManagementFeeItems < ActiveRecord::Migration[8.0]
  # 指導・管理料の項目マスタ。医師がカルテの「指導・管理料」で算定する医学管理料(点数表 B 章)・
  # 在宅(C 章)を、施設が使うものだけ診療行為マスタから選んで登録する。点数・名称の正は
  # master_medical_procedures で、ここには写さない(一覧で結合して添える)。
  def change
    create_table :master_management_fee_items do |t|
      t.string :item_code, null: false # 独自採番の項目コード
      t.string :name, null: false      # 画面に出す名称
      t.string :name_kana              # カナ名称。検索用の入力元
      t.string :receipt_code, null: false # レセ電算 診療行為コード(9 桁)
      # 一緒に算定しうる加算のレセ電算コード(9 桁の配列)。フォームに候補として出す。
      t.jsonb :addition_codes, null: false, default: []
      t.boolean :inpatient, null: false, default: true  # 入院で算定できる
      t.boolean :outpatient, null: false, default: true # 外来で算定できる
      # 1 か月の算定回数の上限。超えるとフォームに注意を出す。空なら見張らない。
      t.integer :monthly_limit
      t.boolean :active, null: false, default: true
      t.integer :display_order
      t.text :note

      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_management_fee_items, :item_code, unique: true
    add_index :master_management_fee_items, :receipt_code
  end
end
