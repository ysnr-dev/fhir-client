class CreateMasterMedicineAttributes < ActiveRecord::Migration[8.0]
  def change
    # 薬剤付加情報(docs/lot-number-design.md)。医薬品マスタに無い、施設独自の薬剤の設定を 1 薬 1 行で持つ。
    # 項目は settings(jsonb)に入れ、項目の定義は Master::MedicineAttribute::ATTRIBUTES の表に置く
    # (項目を足すときに migration を要らないようにするため)。医薬品マスタは取込のたびに入れ直すので
    # FK は張らず、レセプト電算コードで緩く結ぶ。
    create_table :master_medicine_attributes do |t|
      t.string :medicine_code, null: false
      t.jsonb :settings, null: false, default: {}
      t.text :note

      t.timestamps
    end

    add_index :master_medicine_attributes, :medicine_code, unique: true
  end
end
