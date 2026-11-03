class AddProperCriteriaToMasterPathwayAssessments < ActiveRecord::Migration[8.0]
  # 観察項目の適正値を構造化した基準。数値なら下限・上限(どちらか片方でもよい)、列挙なら許容値の配列。
  # 実績値から観察項目ごとの達成 / 未達成を導き、アウトカムの達成状態を提案する
  # (docs/clinical-pathway-design.md §7.15)。proper_value(文字列)は表示用に残す。
  def change
    add_column :master_pathway_assessments, :proper_low, :float
    add_column :master_pathway_assessments, :proper_high, :float
    add_column :master_pathway_assessments, :proper_values, :jsonb
  end
end
