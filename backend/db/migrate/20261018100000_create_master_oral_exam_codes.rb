class CreateMasterOralExamCodes < ActiveRecord::Migration[8.0]
  # 口腔診査情報標準コード仕様(JDAOES Ver.1.02)のコード表。患者ごとの診査結果は上流の
  # Observation に持ち、ここは選択肢の名称・コード体系の OID・標準プロファイル 26 項目への対応を持つ。
  # 本番は起動時に db:seed が走らないので、同梱の CSV の投入もこの migration で行う。
  def up
    create_table :master_oral_exam_codes do |t|
      t.string :record, null: false      # TB / TD / TP / TM / TE / TF / NS / KS / KK / SI / SK
      t.string :item, null: false        # 項目識別名称(TP-11)
      t.string :item_name                # 項目名(処置歯（部分修復）)
      t.string :code, null: false        # 項目コード値(38)
      t.string :display, null: false     # 項目内容
      t.string :tf_ref                   # 対応する標準プロファイル 26 項目(TF-8)
      t.string :cs_name                  # コーディングシステム名(JDASTP11)
      t.string :cs_oid                   # コーディングシステム名の OID
      t.string :note                     # 備考(有効期限・死後記録など)
      t.integer :display_order

      t.timestamps
    end
    add_index :master_oral_exam_codes, %i[item code], unique: true
    add_index :master_oral_exam_codes, :record

    Master::OralExamCode.reset_column_information
    result = OralExamCodeSeed.load!
    say "oral_exam_codes: created #{result.created}, kept #{result.kept}", true
  end

  def down
    drop_table :master_oral_exam_codes
  end
end
