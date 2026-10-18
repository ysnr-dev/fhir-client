class CreateSmartApps < ActiveRecord::Migration[8.0]
  # カルテから起動する SMART on FHIR アプリの台帳(docs/smart-app-launch-design.md)。
  # 認可は上流の OAuth クライアント(client_id)が担い、ここは「どのアプリをどこに出すか」だけを持つ。
  def change
    create_table :smart_apps do |t|
      t.string :name, null: false
      t.string :client_id, null: false
      t.string :launch_url, null: false
      t.string :display, null: false, default: "embed"
      t.boolean :enabled, null: false, default: true
      t.integer :position, null: false, default: 0
      t.timestamps
    end
    add_index :smart_apps, :client_id, unique: true

    # ブラウザから見た上流の URL(SMART の iss)。backend が上流を呼ぶ base_url とは別になり得る。
    add_column :fhir_connection_settings, :public_base_url, :string
  end
end
