class ScopePathwayKeysToParent < ActiveRecord::Migration[8.0]
  # 同じアウトカム・観察項目・タスクを複数の病日にまたがって置けるよう、識別子の一意性を
  # パス内から親(病日・OAT ユニット)の中へ緩める。病日ごとに行を持ったまま同じ識別子を
  # 並べるのが「続き」で、適用後の識別子は病日の識別子の下に入るので重ならない
  # (docs/clinical-pathway-design.md §3.1)。
  def change
    remove_index :master_pathway_oat_units, %i[pathway_code unit_key], unique: true
    add_index :master_pathway_oat_units, %i[event_id unit_key], unique: true
    add_index :master_pathway_oat_units, %i[pathway_code unit_key]

    remove_index :master_pathway_assessments, %i[pathway_code assessment_key], unique: true
    add_index :master_pathway_assessments, %i[unit_id assessment_key], unique: true
    add_index :master_pathway_assessments, %i[pathway_code assessment_key]

    remove_index :master_pathway_tasks, %i[pathway_code task_key], unique: true
    add_index :master_pathway_tasks, %i[unit_id task_key], unique: true
    add_index :master_pathway_tasks, %i[pathway_code task_key]
  end
end
