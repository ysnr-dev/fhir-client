class CreateDicomInstances < ActiveRecord::Migration[8.0]
  def change
    # 取り込んだ DICOM の 1 インスタンス(1 ファイル)。実体は Active Storage に置く。
    # 上流の ImagingStudy はこの行の集まりから組み立てるので、スタディ・シリーズの
    # 属性も行に持つ(同じスタディの行はどれも同じ値)。
    create_table :dicom_instances do |t|
      t.string :sop_instance_uid, null: false
      t.string :study_instance_uid, null: false
      t.string :series_instance_uid, null: false
      # 取込先の患者(FHIR の Patient.id)。DICOM 側の患者 ID ではない。
      t.string :patient_id, null: false
      t.string :sop_class_uid, null: false
      t.string :transfer_syntax_uid

      t.string :modality
      t.integer :series_number
      t.integer :instance_number
      t.integer :number_of_frames
      t.string :series_description
      t.string :body_part

      t.string :study_date
      t.string :study_time
      t.string :study_description
      t.string :accession_number
      t.string :institution_name

      # DICOM のタグに書かれていた患者(他院の CD なら他院の患者番号)。暗号化して持つ。
      t.text :source_patient_id
      t.text :source_patient_name

      t.bigint :byte_size, null: false, default: 0

      t.timestamps
    end

    add_index :dicom_instances, :sop_instance_uid, unique: true
    add_index :dicom_instances, %i[patient_id study_instance_uid]
    add_index :dicom_instances, %i[study_instance_uid series_instance_uid instance_number],
              name: :index_dicom_instances_on_study_series_number
  end
end
