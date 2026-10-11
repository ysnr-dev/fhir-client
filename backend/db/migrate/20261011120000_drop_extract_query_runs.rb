class DropExtractQueryRuns < ActiveRecord::Migration[8.0]
  # データ抽出は実行した時点の結果だけを出す(過去は条件の期間で見る)ので、実行の記録は持たない。
  def change
    drop_table :extract_query_runs do |t|
      t.references :extract_query, null: false, foreign_key: { on_delete: :cascade }
      t.datetime :ran_at, null: false
      t.integer :patient_count, null: false
      t.jsonb :leaf_counts, null: false, default: {}
      t.string :ran_by_id
      t.string :ran_by_name
      t.timestamps
      t.index %i[extract_query_id ran_at]
    end
  end
end
