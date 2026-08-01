class CreateUsers < ActiveRecord::Migration[8.0]
  def change
    create_table :users do |t|
      t.string :login_id, null: false
      t.string :password_digest, null: false
      # 上流 FHIR サーバーの Practitioner リソース ID。Practitioner 本体は
      # ローカル DB に持たない(医療従事者画面が /fhir 経由で直接操作する)。
      t.string :practitioner_fhir_id, null: false

      t.timestamps
    end

    add_index :users, :login_id, unique: true
    add_index :users, :practitioner_fhir_id, unique: true
  end
end
