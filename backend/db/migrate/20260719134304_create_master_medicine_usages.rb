class CreateMasterMedicineUsages < ActiveRecord::Migration[7.0]
  def change
    create_table :master_medicine_usages do |t|
      t.string :usage_code, null: false
      t.string :basic_usage_category_code
      t.string :basic_usage_category
      t.string :detailed_usage_category_code
      t.string :detailed_usage_category
      t.string :timing_category_code
      t.string :timing_category
      t.string :usage_name
      t.string :standard_usage_number
      t.string :start_date
      t.string :end_date
      t.string :usage_code_category

      t.timestamps
    end

    add_index :master_medicine_usages, :usage_code, unique: true
    add_index :master_medicine_usages, :usage_name
  end
end
