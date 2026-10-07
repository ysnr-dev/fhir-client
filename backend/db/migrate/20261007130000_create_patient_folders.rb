class CreatePatientFolders < ActiveRecord::Migration[8.0]
  # 患者フォルダ(患者を任意の階層の分類に仕分ける入れ物)。フォルダは parent_id の隣接リストで
  # 任意の深さに積み、持ち主はオーダーセットと同じ 3 段階(院内共通 / 診療科 / 本人)。
  # 患者は上流 FHIR の Patient.id を文字列で持つ(patient_chart_pins と同じ)。
  # 外部キーは張らず、整合性はアプリ側の削除ガードで守る(他の表と同じ方針)。
  def change
    create_table :patient_folders do |t|
      t.bigint :parent_id              # 親フォルダ。NULL はその持ち主の最上位
      t.string :scope, null: false     # "facility" | "department" | "practitioner"
      t.string :owner_id               # 診療科 Organization.id / Practitioner.id。facility は NULL
      t.string :owner_name             # 表示用(上流を引き直さない)
      t.string :name, null: false
      t.integer :display_order         # 同じ親の中での表示順
      t.timestamps
    end
    add_index :patient_folders, %i[scope owner_id parent_id]
    add_index :patient_folders, :parent_id

    create_table :patient_folder_members do |t|
      t.bigint :patient_folder_id, null: false
      t.string :patient_id, null: false  # 上流 Patient.id
      t.string :note                     # 登録の理由などのメモ
      t.string :added_by_id              # 登録した Practitioner.id
      t.string :added_by_name            # 表示用
      t.timestamps
    end
    add_index :patient_folder_members, %i[patient_folder_id patient_id], unique: true
    add_index :patient_folder_members, :patient_id
  end
end
