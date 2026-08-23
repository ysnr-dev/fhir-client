class DropLabLabelNumbers < ActiveRecord::Migration[8.0]
  # 検体ラベル番号の採番は上流 fhir-server(Fhir::AccessionAssigner)に移した。
  # backend に残っていた採番専用テーブル(created_at しか持たない連番消費用の行)は
  # もう使わない。既存の番号は上流 Specimen.accessionIdentifier に保存済みで、
  # このテーブルには参照すべきデータが無いので単純に落とす。
  #
  # デプロイ順: 上流(SPECIMEN_ACCESSION_SYSTEM 設定込み)を先に。上流が未対応の間に
  # この版の backend が動くと、ラベル発行が「番号なし Specimen」で失敗する。
  def up
    drop_table :lab_label_numbers
  end

  def down
    create_table :lab_label_numbers do |t|
      t.datetime :created_at, null: false
    end
  end
end
