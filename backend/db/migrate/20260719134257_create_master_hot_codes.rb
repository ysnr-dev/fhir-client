class CreateMasterHotCodes < ActiveRecord::Migration[7.0]
  def change
    create_table :master_hot_codes do |t|
      t.string :hot_code, null: false
      t.string :hot7_code
      t.string :company_identification_number
      t.string :dispensing_number
      t.string :logistics_number
      t.string :jan_code
      t.string :yakka_code
      t.string :individual_medicine_code
      t.string :receipt_code_1
      t.string :receipt_code_2
      t.string :notification_name
      t.string :sales_name
      t.string :receipt_medicine_name
      t.string :standard_unit
      t.string :package_form
      t.decimal :package_unit_quantity, precision: 12, scale: 3
      t.string :package_unit_unit
      t.decimal :package_total_quantity, precision: 12, scale: 3
      t.string :package_total_unit
      t.string :category
      t.string :manufacturer
      t.string :distributor
      t.string :update_category
      t.string :updated_on

      t.timestamps
    end

    # Not unique: the real MEDIS master contains multiple distinct products
    # (different individual_medicine_code / sales_name) sharing the same
    # hot_code, so a uniqueness constraint here would reject valid data.
    add_index :master_hot_codes, :hot_code
    add_index :master_hot_codes, :hot7_code
    add_index :master_hot_codes, :jan_code
    add_index :master_hot_codes, :yakka_code
    add_index :master_hot_codes, :individual_medicine_code
    add_index :master_hot_codes, :receipt_code_1
    add_index :master_hot_codes, :sales_name
  end
end
