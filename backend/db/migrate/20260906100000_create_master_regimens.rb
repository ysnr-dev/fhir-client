class CreateMasterRegimens < ActiveRecord::Migration[8.0]
  # 化学療法レジメンマスタの本体(docs/chemo-regimen-design.md)。
  # レジメンは審査委員会で承認する施設共通の参照表なので、オーダーセットのような
  # 持ち主の階層は持たず、診療科・適応疾患は分類属性として持つ。
  # 1 クールの長さは投与期間 + 休薬期間で、和は保存せず導出する。
  def change
    create_table :master_regimens do |t|
      t.string :regimen_code, null: false
      t.string :name, null: false
      t.string :short_name
      t.string :name_kana
      t.string :department_code                  # 診療科(上流 Organization の識別コード)
      t.string :department_name                  # 表示用の非正規化
      t.string :purpose                          # neoadjuvant / adjuvant / curative / palliative / other
      t.string :setting                          # outpatient / inpatient / both
      t.integer :treatment_days                  # 投与期間(日)
      t.integer :rest_days                       # 休薬期間(日)
      t.integer :planned_cycles                  # 予定クール数(NULL = 継続)
      t.string :emetic_risk                      # high / moderate / low / minimal
      t.string :status, null: false, default: "draft" # draft / approved / retired
      t.date :approved_on
      t.string :approved_by
      t.text :indication_note                    # 適応基準の補足(自由記述)
      t.text :discontinuation_criteria           # 中止基準
      t.text :dose_reduction_criteria            # 減量基準
      t.text :references_note                    # 参考文献
      t.date :valid_from
      t.date :valid_to
      t.integer :display_order
      t.text :note
      t.string :search_name
      t.string :search_kana
      t.string :search_short_name
      t.timestamps
    end
    add_index :master_regimens, :regimen_code, unique: true
    add_index :master_regimens, :department_code
    add_index :master_regimens, :status
  end
end
