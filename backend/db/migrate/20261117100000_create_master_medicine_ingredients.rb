class CreateMasterMedicineIngredients < ActiveRecord::Migration[8.0]
  # 成分マスタ。薬価基準コード(YJ コード・一般名処方コードも同じ体系)の上 7 桁または上 9 桁から、
  # 薬効分類を含まない成分を引く。配合剤は成分の数だけ行を持つ。
  # docs/drug-check-master-design.md
  def change
    create_table :master_medicine_ingredients do |t|
      t.string :code_prefix, null: false     # コードの上 7 桁。規格で成分が変わる薬だけ上 9 桁
      t.bigint :ingredient_id, null: false   # 成分の ID(OMOP の concept_id)
      t.string :name, null: false            # 成分名(英)
      t.string :name_ja                      # 成分名(日)。配合剤にしか出ない成分は空
      t.string :rxcui                        # RxNorm の RxCUI。RxNorm Extension の成分は空
      t.timestamps
      t.index %i[code_prefix ingredient_id], unique: true
      t.index :ingredient_id
    end
  end
end
