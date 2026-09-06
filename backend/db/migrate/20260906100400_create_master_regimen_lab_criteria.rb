class CreateMasterRegimenLabCriteria < ActiveRecord::Migration[8.0]
  # レジメンの適応基準のうち検査結果値(腎機能・肝機能・血液検査)。
  # 検査項目は JLAC11 の分析物 5 桁で持ち、材料・測定法の違いをまとめる
  # (身長・体重と腎機能の読み取りと同じ流儀)。CCr のような計算値は名称だけで持てる。
  def change
    create_table :master_regimen_lab_criteria do |t|
      t.string :regimen_code, null: false
      t.integer :display_order
      t.string :category, null: false            # renal / hepatic / blood / other
      t.string :analyte_code                     # JLAC11 分析物コード(5 桁)。空可
      t.string :item_name, null: false
      t.string :unit
      t.decimal :lower_limit, precision: 12, scale: 3
      t.decimal :upper_limit, precision: 12, scale: 3
      t.text :note
      t.timestamps
    end
    add_index :master_regimen_lab_criteria, :regimen_code
    add_index :master_regimen_lab_criteria, :analyte_code
  end
end
