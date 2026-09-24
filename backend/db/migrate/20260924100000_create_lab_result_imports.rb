class CreateLabResultImports < ActiveRecord::Migration[8.0]
  # 検体検査結果の取込(JAHIS 臨床検査データ交換規約 / HL7 v2.5)の台帳。
  # 施設の参照表ではなく現場の作業キューなので master_ を付けない(order_sets と同じ)。
  # 上流 FHIR への登録は画面側(useCreateLabResult / useUpdateLabResult)が行い、
  # ここにはファイルの解析結果と行ごとの状態だけを持つ。docs/lab-result-import-design.md。
  # 外部キーは張らない(他マスタと同じ方針)。
  def change
    create_table :lab_result_imports do |t|
      t.string :source                                    # MSH-4(空なら MSH-3)。取込元
      t.string :format, null: false, default: "hl7_v25"
      t.string :message_type                              # MSH-9 の "ORU^R01" / "OUL^R22"
      t.string :encoding                                  # 実際に使った文字コード
      t.string :encoding_reason                           # manual/bom/escape/msh18/utf8_valid/fallback
      t.string :file_name
      t.string :message_control_id                        # MSH-10
      t.datetime :message_datetime                        # MSH-7
      t.string :imported_by_login_id
      t.string :imported_by_practitioner_id
      t.integer :row_count, null: false, default: 0
      t.integer :skipped_count, null: false, default: 0   # OBX-11 が X/D で読み飛ばした数
      t.text :note
      t.timestamps
    end
    add_index :lab_result_imports, :created_at
    add_index :lab_result_imports, :source
    add_index :lab_result_imports, :message_control_id

    create_table :lab_result_import_rows do |t|
      t.bigint :lab_result_import_id, null: false
      # 候補のまとまり(ORC/OBR 群)。1 群 = 上流の DiagnosticReport 1 件になる。
      t.integer :group_no, null: false
      t.integer :sequence, null: false

      # 患者。ヘッダは行に非正規化して持つ(保留になる単位が行なので、行の独立性を優先)。
      t.string :patient_number
      t.string :patient_name
      t.date :patient_birth_date
      t.string :patient_sex
      t.string :setting                                   # inpatient / outpatient

      # オーダーと検体
      t.string :placer_order_number
      t.string :filler_order_number
      t.jsonb :specimen_ids, null: false, default: []     # SPM-2 の全部
      t.string :label_number                              # 検体ラベル番号(11 桁 + チェックデジット)
      t.string :specimen_material_code
      t.string :specimen_material_name
      t.datetime :collected_at
      t.datetime :reported_at                             # OBR-22
      t.string :report_status                             # OBR-25
      t.text :report_comment                              # OBR 直後の NTE

      # 結果(OBX 1 件)
      t.string :external_code
      t.string :external_name
      t.string :external_code_system
      t.string :jlac10_code                               # OBX-3 から抜いた JLAC。再引き当てを
      t.string :jlac11_code                               # 再パース無しで回すため列に持つ
      t.string :value_type                                # OBX-2
      t.string :value
      t.string :value_text                                # CE/CWE の表示名
      t.string :value_code_system
      t.string :unit
      t.string :reference_range                           # OBX-7(参考表示のみ)
      t.string :abnormal_flag                             # OBX-8
      t.string :observation_status                        # OBX-11
      t.datetime :observed_at                             # OBX-14
      t.text :note                                        # OBX 直後の NTE

      # 引き当てと状態
      t.string :result_item_code
      t.string :resolution                                # jlac10/jlac11/jlac10_prefix/jlac11_prefix/manual
      t.string :status, null: false, default: "pending"   # pending/ready/skipped/registered
      t.string :pending_reason                            # item_unresolved/item_ambiguous/value_unmatched/value_not_numeric
      t.jsonb :candidate_item_codes, null: false, default: []

      # 上流への登録
      t.string :patient_fhir_id
      t.string :order_fhir_id
      t.string :report_fhir_id
      t.datetime :registered_at
      t.string :registered_by_practitioner_id
      t.timestamps
    end
    add_index :lab_result_import_rows, %i[lab_result_import_id group_no sequence],
              name: "index_lab_result_import_rows_on_position"
    add_index :lab_result_import_rows, %i[lab_result_import_id status],
              name: "index_lab_result_import_rows_on_import_and_status"
    add_index :lab_result_import_rows, %i[lab_result_import_id external_code],
              name: "index_lab_result_import_rows_on_import_and_code"
    add_index :lab_result_import_rows, :label_number
    add_index :lab_result_import_rows, :report_fhir_id
  end
end
