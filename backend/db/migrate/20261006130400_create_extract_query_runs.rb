class CreateExtractQueryRuns < ActiveRecord::Migration[8.0]
  # データ抽出の実行の記録(定点観測の推移。docs/data-extract-design.md)。保存した条件を
  # 直さずに実行したときだけ、該当人数と条件ごとの人数を残す。患者は持たない。
  def change
    create_table :extract_query_runs do |t|
      t.references :extract_query, null: false, foreign_key: { on_delete: :cascade }
      t.datetime :ran_at, null: false
      t.integer :patient_count, null: false
      # 条件の key → その条件だけで当たった人数。
      t.jsonb :leaf_counts, null: false, default: {}
      t.string :ran_by_id
      t.string :ran_by_name
      t.timestamps
    end
    add_index :extract_query_runs, %i[extract_query_id ran_at]
  end
end
