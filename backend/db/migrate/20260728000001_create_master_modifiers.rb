class CreateMasterModifiers < ActiveRecord::Migration[7.0]
  def change
    create_table :master_modifiers do |t|
      t.string :change_category
      t.string :management_number, null: false
      t.string :name, null: false
      t.string :name_kana
      t.string :exchange_code

      t.string :connection_position_category
      t.string :modifier_category
      t.string :exclusive_group_code
      t.string :receipt_code
      t.string :description_label

      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_modifiers, :management_number, unique: true
    add_index :master_modifiers, :exchange_code
  end
end
