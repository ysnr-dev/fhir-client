class AddMaintenanceToMasterAdvisoryRules < ActiveRecord::Migration[8.0]
  # 定期検査・検診の規則(docs/advisory-design.md §2.10)。条件式が対象の患者を選び、
  # ここに持つ項目(検査項目 / 実施記録 / 予防接種のコード)と間隔で期限を出す。
  def change
    add_column :master_advisory_rules, :maintenance, :jsonb
  end
end
