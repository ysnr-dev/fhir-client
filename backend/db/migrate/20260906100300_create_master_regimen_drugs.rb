class CreateMasterRegimenDrugs < ActiveRecord::Migration[8.0]
  # 投与ステップの中の薬剤 1 件。薬剤マスタ(master_medicines)を medicine_code で
  # 参照し、投与量は算出基準(体表面積 / 体重 / AUC / 固定量 / 製剤単位)付きで持つ。
  # regimen_code は「この薬剤を含むレジメン」を引くための冗長列。
  def change
    create_table :master_regimen_drugs do |t|
      t.string :regimen_code, null: false
      t.bigint :step_id, null: false
      t.integer :display_order
      t.string :drug_role, null: false           # anticancer / fluid / antiemetic / premedication / supportive / other
      t.string :medicine_code, null: false
      t.string :dose_basis, null: false          # bsa / weight / auc / fixed / unit
      t.decimal :dose_value, precision: 12, scale: 3   # 基準値
      t.string :dose_unit                        # mg / mg·min/mL / 薬価算定単位名 …
      t.decimal :dose_max, precision: 12, scale: 3     # 上限値(基準値と同じ単位)
      t.text :note
      t.timestamps
    end
    add_index :master_regimen_drugs, %i[step_id display_order]
    add_index :master_regimen_drugs, :regimen_code
    add_index :master_regimen_drugs, :medicine_code
  end
end
