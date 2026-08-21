class CreateMasterJfagyDrugs < ActiveRecord::Migration[7.0]
  def change
    create_table :master_jfagy_drugs do |t|
      t.string :jfagy_code, null: false
      t.string :name, null: false
      t.string :record_date
      t.string :end_date
      t.string :change_category
      t.string :search_name

      t.timestamps
    end

    add_index :master_jfagy_drugs, :jfagy_code, unique: true
    add_index :master_jfagy_drugs, :search_name
  end
end
