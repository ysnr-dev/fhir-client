class AddFormToMasterNursingAcuityCodes < ActiveRecord::Migration[8.0]
  # コード一覧は評価票の版ごとに配布される(別紙7 一般病棟用、別紙17 特定集中治療室用、別紙18 ハイケアユニット用)。
  # 取込は (form, kind) 単位で洗い替える(docs/nursing-acuity-design.md §7)。
  def change
    add_column :master_nursing_acuity_codes, :form, :string, null: false, default: "general"
    add_index :master_nursing_acuity_codes, %i[form kind code]
  end
end
