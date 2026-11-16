class AddAtcAndAmountToMasterMedicineIngredients < ActiveRecord::Migration[8.0]
  # 成分マスタに薬理の群(ATC 分類)と配合剤の含量を足す。docs/drug-check-master-design.md §1.1
  def change
    change_table :master_medicine_ingredients, bulk: true do |t|
      t.string :atc_codes, null: false, default: "" # その成分が主成分の ATC コード(5 階層目)。空白区切り
      t.decimal :amount, precision: 16, scale: 6    # 1 薬価単位(錠・カプセル)あたりの量。配合剤で分かるものだけ
      t.string :amount_unit                         # amount の単位(mg)
    end

    # ATC 分類の 2〜4 階層目の名称(薬剤チェックの規則で群を選ぶときの候補)。
    create_table :master_atc_classes do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.timestamps
      t.index :code, unique: true
    end
  end
end
