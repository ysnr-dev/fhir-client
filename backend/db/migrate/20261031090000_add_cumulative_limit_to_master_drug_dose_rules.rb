class AddCumulativeLimitToMasterDrugDoseRules < ActiveRecord::Migration[8.0]
  def change
    # 生涯の累積投与量の上限(アントラサイクリン・ブレオマイシンなど)。単位は dose_unit と共用。
    # 化学療法の適用・次クール登録で、レジメンの日オーダーを積算して比べる(docs/chemo-regimen-design.md §8.23)。
    add_column :master_drug_dose_rules, :max_cumulative_dose, :decimal, precision: 12, scale: 4
    # 累積上限が体表面積 1 m² あたり。
    add_column :master_drug_dose_rules, :cumulative_per_bsa, :boolean, null: false, default: false
  end
end
