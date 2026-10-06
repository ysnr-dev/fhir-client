class CreateSupervisorGroups < ActiveRecord::Migration[8.0]
  def change
    # 指導医グループ(docs/countersign-design.md)。研修医・学生が書いた診療記録とオーダーを、
    # 同じグループの指導医の誰かがカウンターサインする。施設の運用データなので上流 FHIR には
    # 置かず、掲示板と同じく backend に持つ。
    create_table :supervisor_groups do |t|
      t.string :name, null: false
      t.text :note

      t.timestamps
    end

    add_index :supervisor_groups, :name, unique: true

    create_table :supervisor_group_members do |t|
      t.references :supervisor_group, null: false,
                                      foreign_key: { on_delete: :cascade }
      # 上流 Practitioner の id と、保存時点の表示名(一覧は Practitioner を引き直さない)。
      t.string :practitioner_fhir_id, null: false
      t.string :display_name, null: false, default: ""
      # supervisor(指導医)か trainee(研修医・学生)か。
      t.string :role, null: false

      t.timestamps
    end

    add_index :supervisor_group_members, %i[supervisor_group_id practitioner_fhir_id], unique: true,
              name: "index_supervisor_group_members_on_group_and_practitioner"
    add_index :supervisor_group_members, :practitioner_fhir_id
  end
end
