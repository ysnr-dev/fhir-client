class CreateMasterMedicines < ActiveRecord::Migration[7.0]
  def change
    create_table :master_medicines do |t|
      t.string :change_category
      t.string :master_type
      t.string :medicine_code, null: false

      t.integer :name_kanji_length
      t.string :name
      t.integer :name_kana_length
      t.string :name_kana

      t.string :unit_code
      t.integer :unit_name_length
      t.string :unit_name

      t.string :price_type
      t.decimal :price, precision: 13, scale: 2

      t.string :reserve1
      t.string :narcotic_category
      t.string :nerve_destruction_flag
      t.string :biological_product_flag
      t.string :generic_flag
      t.string :reserve2
      t.string :dental_specific_flag
      t.string :contrast_medium_category
      t.string :injection_volume
      t.string :listing_method_category
      t.string :brand_name_related_code

      t.string :old_price_type
      t.decimal :old_price, precision: 13, scale: 2

      t.string :name_change_flag
      t.string :kana_change_flag
      t.string :dosage_form
      t.string :reserve3

      t.string :changed_on
      t.string :abolished_on
      t.string :yakka_code
      t.string :publication_order
      t.string :transitional_measure_on

      t.string :basic_name

      t.string :listed_on
      t.string :generic_name_code
      t.string :generic_name_description
      t.string :generic_name_addition_category
      t.string :anti_hiv_flag
      t.string :long_term_listed_related_code
      t.string :selective_treatment_category

      t.timestamps
    end

    add_index :master_medicines, :medicine_code, unique: true
    add_index :master_medicines, :name
    add_index :master_medicines, :yakka_code
    add_index :master_medicines, :generic_name_code
  end
end
