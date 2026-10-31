class AddPrescriptionChecks < ActiveRecord::Migration[8.0]
  def change
    # 投与日数の上限(新薬・麻薬・向精神薬の 14 日 / 30 日 / 90 日など)。処方の日数を持つ内服と比べる。
    add_column :master_drug_dose_rules, :max_days, :integer

    # 病名と薬の禁忌・注意(docs/drug-check-master-design.md)。薬は YJ コードの先頭 4〜7 桁、
    # 病名は ICD-10 の前方一致(3 桁で分類ごと、4 桁以上で細分類)。
    create_table :master_drug_disease_rules do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.string :disease_code, null: false
      t.string :disease_name, null: false
      # contraindicated = 禁忌 / caution = 注意
      t.string :severity, null: false
      t.text :note

      t.timestamps
    end

    add_index :master_drug_disease_rules, %i[code disease_code], unique: true
  end
end
