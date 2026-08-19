class ReplaceLabLabelRecordsWithNumbers < ActiveRecord::Migration[8.0]
  # 検体ラベルの台帳を上流の Specimen リソースへ一本化する(docs/lab-arrival-design.md §6-1)。
  # 番号 → オーダー・検体の対応、発行済み、到着(receivedTime)はすべて Specimen が持つので、
  # backend に残るのは番号の採番だけになる。lab_label_numbers は行 = 採番 1 回の
  # カウンタ(番号は id から組む。PostgreSQL のシーケンスを直接使わないのは、
  # schema.rb が単体のシーケンスをダンプできず test DB に反映されないため)。
  def up
    create_table :lab_label_numbers do |t|
      t.datetime :created_at, null: false
    end

    # 既に発行済みの番号と重ならないよう、旧台帳の続き番号から始める
    # (旧台帳の行は上流の Specimen へ移行済みであること)。
    execute <<~SQL
      SELECT setval(
        pg_get_serial_sequence('lab_label_numbers', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM lab_label_records)
      )
    SQL

    drop_table :lab_label_records
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
