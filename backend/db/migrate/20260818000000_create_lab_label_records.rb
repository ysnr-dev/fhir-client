class CreateLabLabelRecords < ActiveRecord::Migration[8.0]
  # 検体ラベルの発行記録。ラベルに刷る番号(バーコード)と、その番号が指す
  # オーダー・検体・採取管の対応を持つ(docs/lab-label-design.md §3-3)。
  # 番号に意味を持たせず、到着確認でのスキャン逆引きはこのテーブルで行う。
  def change
    create_table :lab_label_records do |t|
      # ヘッダ ServiceRequest の id(上流採番の UUID)
      t.string :order_fhir_id, null: false
      # JLAC11 材料コード。検体未設定の項目だけのグループは ""
      t.string :specimen_code, null: false, default: ""
      t.string :container_code, null: false, default: ""
      # 採番済みの 11 桁(id の 10 桁ゼロ埋め + チェックデジット)。
      # 行を作ってから id で組むため、作成直後だけ NULL になる。
      t.string :label_number

      t.timestamps
      t.index %i[order_fhir_id specimen_code], unique: true
      t.index :label_number, unique: true
    end
  end
end
