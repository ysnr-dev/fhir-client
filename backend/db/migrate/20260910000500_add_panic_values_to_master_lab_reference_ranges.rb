class AddPanicValuesToMasterLabReferenceRanges < ActiveRecord::Migration[8.0]
  # パニック値(緊急異常値)。基準値と同じ「項目 × 性別 × 年齢帯」で決まる判定の境界なので、
  # 別テーブルにせず基準値の行に持たせる(適用する行の選び方を 2 か所に分けないため)。
  # 基準値を持たずパニック値だけの項目もあるので、下限・上限は 4 つとも任意にする。
  def change
    add_column :master_lab_reference_ranges, :panic_lower, :decimal, precision: 12, scale: 3
    add_column :master_lab_reference_ranges, :panic_upper, :decimal, precision: 12, scale: 3
  end
end
