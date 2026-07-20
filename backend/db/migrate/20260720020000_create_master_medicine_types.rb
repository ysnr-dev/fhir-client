class CreateMasterMedicineTypes < ActiveRecord::Migration[7.0]
  def change
    create_table :master_medicine_types do |t|
      # 薬効分類番号（日本標準商品分類「87」の細分類, 4桁）とその名称。
      # YJコード（master_medicines.yakka_code）の上4桁がこの code に対応する。
      t.string :code, null: false
      t.string :name
      t.string :search_name

      t.timestamps
    end

    add_index :master_medicine_types, :code, unique: true
  end
end
