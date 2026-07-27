class CreateMasterDiseases < ActiveRecord::Migration[7.0]
  def change
    create_table :master_diseases do |t|
      t.string :change_category
      t.string :management_number, null: false
      t.string :name, null: false
      t.string :name_kana
      t.string :adoption_category
      t.string :exchange_code

      t.string :icd10_2013
      t.string :icd10_2013_secondary
      t.string :reserve1
      t.string :reserve2

      t.string :receipt_code
      t.string :abbreviated_name
      t.string :usage_field

      t.string :change_history_number
      t.string :updated_on
      t.string :transfer_management_number
      t.string :single_use_prohibited_category
      t.string :non_billable_category
      t.string :reserve3
      t.string :reserve4

      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_diseases, :management_number, unique: true
    add_index :master_diseases, :exchange_code
    add_index :master_diseases, :icd10_2013
  end
end
