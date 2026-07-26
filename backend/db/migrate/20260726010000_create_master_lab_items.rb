class CreateMasterLabItems < ActiveRecord::Migration[7.0]
  def change
    create_table :master_lab_items do |t|
      t.string :category_name
      t.string :reserve_category_name
      t.string :emergency_flag
      t.string :lifestyle_disease_flag
      t.string :data_category

      t.string :major_item
      t.string :fhir_item_name
      t.string :fhir_identifier
      t.string :abbreviation
      t.string :sales_name

      t.string :jlac11_specimen
      t.string :jlac11_method
      t.string :jlac11_code, null: false
      t.string :display_unit
      t.string :display_unit2
      t.string :xml_unit
      t.string :xml_unit2

      t.string :jlac10_specimen
      t.string :jlac10_method
      t.string :jlac10_code

      t.string :reference_lower_flag
      t.string :reference_upper_flag
      t.string :reference_judgment_flag

      t.string :data_type
      t.string :value_lower_limit
      t.string :value_upper_limit
      t.string :numeric_format
      t.string :code_value_list
      t.string :code_oid

      t.string :display_order
      t.string :start_date
      t.string :end_date

      t.string :search_name
      t.string :search_abbreviation

      t.timestamps
    end

    add_index :master_lab_items, :jlac11_code, unique: true
    add_index :master_lab_items, :jlac10_code
    add_index :master_lab_items, :fhir_item_name
  end
end
