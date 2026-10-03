class CreateMasterDrugChecks < ActiveRecord::Migration[8.0]
  def change
    # 薬剤の相互作用(併用禁忌・併用注意)。施設で登録する参照表(docs/drug-check-master-design.md)。
    # 薬は YJ コードの先頭 4〜7 桁で指す。7 桁 = 成分、4 桁 = 薬効分類(群でまとめて書くため)。
    create_table :master_drug_interactions do |t|
      t.string :code_a, null: false
      t.string :name_a, null: false
      t.string :code_b, null: false
      t.string :name_b, null: false
      # contraindicated = 併用禁忌 / caution = 併用注意
      t.string :severity, null: false
      # 機序・症状・対処。
      t.text :note

      t.timestamps
    end

    add_index :master_drug_interactions, %i[code_a code_b], unique: true
    add_index :master_drug_interactions, :code_b

    # 用量と患者条件(年齢・腎機能・体重)の規則。条件がすべて当てはまったときに、
    # 上限があれば用量を比べ、無ければ文言をそのまま出す。
    create_table :master_drug_dose_rules do |t|
      t.string :code, null: false
      t.string :name, null: false
      # 剤形区分(1:内用 4:注射 6:外用)。空ならすべての剤形。
      t.string :dosage_form
      # 年齢 age_from 歳以上 age_to 歳未満。
      t.integer :age_from
      t.integer :age_to
      # 腎機能 renal_index(egfr / ccr)が renal_below 未満。
      t.string :renal_index
      t.decimal :renal_below, precision: 8, scale: 2
      t.decimal :max_single_dose, precision: 12, scale: 4
      t.decimal :max_daily_dose, precision: 12, scale: 4
      t.string :dose_unit
      # 上限が体重 1 kg あたり。
      t.boolean :per_kg, null: false, default: false
      t.string :severity, null: false
      t.text :message

      t.timestamps
    end

    add_index :master_drug_dose_rules, :code
  end
end
