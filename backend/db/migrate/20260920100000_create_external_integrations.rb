# 外部システム連携(レセコン等)の設定とコード対応表。
#
# システム(system_key)ごとに 1 行。どの製品と繋ぐかは system_type で選び、
# それ以外の設定項目は options(jsonb)に逃がす。
class CreateExternalIntegrations < ActiveRecord::Migration[8.0]
  def change
    create_table :external_system_connections do |t|
      t.string  :system_key, null: false      # "receipt_computer"
      t.string  :system_type                  # "orca"。API で繋がないシステムは空
      t.boolean :enabled, null: false, default: false
      t.string  :base_url
      t.string  :username
      t.text    :password                     # encrypts
      t.text    :inbound_token                # encrypts。受信エンドポイントの Bearer
      t.jsonb   :options, null: false, default: {}
      t.timestamps
    end
    add_index :external_system_connections, :system_key, unique: true

    create_table :external_code_mappings do |t|
      t.string :system_type, null: false      # "orca"
      t.string :kind, null: false             # アダプタが宣言する種別
      t.string :local_key, null: false
      t.string :external_code, null: false
      t.string :label
      t.timestamps
    end
    add_index :external_code_mappings, %i[system_type kind local_key], unique: true
    add_index :external_code_mappings, %i[system_type kind external_code]
  end
end
