class CreateMasterPathwayTasks < ActiveRecord::Migration[8.0]
  # タスク(その病日に行う処方・検査・処置・ケア・説明など)。OAT ユニット直下に置き、
  # 観察項目への結びは任意(結ばないタスクは ePath 出力時に空の観察項目で包む)。
  # order_* はオーダーの雛形で、オーダーセットのエントリと同じ形(種別 + フォーム値の jsonb)。
  # 雛形を持たないタスクはチェックリスト項目。
  def change
    create_table :master_pathway_tasks do |t|
      t.string :pathway_code, null: false
      t.bigint :unit_id, null: false
      t.bigint :assessment_id
      t.integer :display_order
      t.string :task_key, null: false                 # タスク識別子(uuid)
      t.string :name, null: false
      t.string :category_lv1, null: false             # タスク分類 大(TP 治療 / EX 検査 / …)
      t.string :category_lv2                          # タスク分類 中(TPPR 処方 / EXSP 検体検査 / …)
      t.string :code                                  # ローカルタスクコード
      t.string :order_type                            # オーダー雛形の種別(NULL = チェックリスト項目)
      t.string :order_label                           # 雛形の要約(一覧表示用)
      t.jsonb :order_values, null: false, default: {} # 雛形のフォーム値
      t.integer :order_schema_version
      t.text :note
      t.timestamps
    end
    add_index :master_pathway_tasks, %i[pathway_code task_key], unique: true
    add_index :master_pathway_tasks, :unit_id
    add_index :master_pathway_tasks, :assessment_id
  end
end
