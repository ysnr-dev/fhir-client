class CreateFhirConnectionSettings < ActiveRecord::Migration[7.0]
  def change
    create_table :fhir_connection_settings do |t|
      t.string  :base_url
      t.string  :client_id
      # ActiveRecord Encryption の暗号文を格納するため text。
      t.text    :client_secret
      t.string  :token_path, null: false, default: "/oauth/token"
      t.string  :host_header
      # 単一行を保証するためのガード列(常に 0)。一意インデックスで 2 行目を弾く。
      t.integer :singleton_guard, null: false, default: 0

      t.timestamps
    end

    add_index :fhir_connection_settings, :singleton_guard, unique: true
  end
end
