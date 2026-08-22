class CreateFacilitySettings < ActiveRecord::Migration[7.0]
  def change
    create_table :facility_settings do |t|
      # 自院の Organization.id(上流 FHIR サーバー上の ID)。未設定なら nil。
      t.string  :self_organization_fhir_id
      # 単一行を保証するためのガード列(常に 0)。一意インデックスで 2 行目を弾く。
      t.integer :singleton_guard, null: false, default: 0

      t.timestamps
    end

    add_index :facility_settings, :singleton_guard, unique: true
  end
end
