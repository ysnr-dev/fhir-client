class CreateNursingAssignments < ActiveRecord::Migration[8.0]
  # 看護の業務分担。病棟・日・勤務帯ごとに、患者 1 人を受け持つ看護師 1 人。
  # 病棟・患者・看護師は上流 FHIR の Location / Patient / Practitioner の id を文字列で持つ
  # (patient_folder_members と同じ。外部キーは張らない)。
  def change
    create_table :nursing_assignments do |t|
      t.string :ward_id, null: false          # 病棟 Location.id
      t.date :assigned_on, null: false
      t.string :shift, null: false            # "day" | "evening" | "night"
      t.string :patient_id, null: false       # 上流 Patient.id
      t.string :practitioner_id, null: false  # 受け持つ看護師 Practitioner.id
      t.string :practitioner_name             # 表示用
      t.string :assigned_by_id                # 割り付けた Practitioner.id
      t.string :assigned_by_name
      t.timestamps
    end
    add_index :nursing_assignments, %i[assigned_on shift patient_id], unique: true
    add_index :nursing_assignments, %i[ward_id assigned_on]
    add_index :nursing_assignments, %i[practitioner_id assigned_on]
  end
end
