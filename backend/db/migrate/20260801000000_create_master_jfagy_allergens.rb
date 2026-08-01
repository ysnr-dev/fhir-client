class CreateMasterJfagyAllergens < ActiveRecord::Migration[7.0]
  def change
    create_table :master_jfagy_allergens do |t|
      t.string :display_seq
      t.string :jfagy_code, null: false
      t.string :name, null: false
      t.string :name_kana
      t.string :name_en
      t.string :level
      t.string :main_flag
      t.string :guideline
      t.string :cxg_category
      t.string :record_date
      t.string :end_date
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_jfagy_allergens, :jfagy_code, unique: true
    add_index :master_jfagy_allergens, :search_name
    add_index :master_jfagy_allergens, :search_kana
  end
end
