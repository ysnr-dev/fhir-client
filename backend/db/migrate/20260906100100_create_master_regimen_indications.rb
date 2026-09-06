class CreateMasterRegimenIndications < ActiveRecord::Migration[8.0]
  # レジメンの適応疾患。病名マスタ(master_diseases)の管理番号で参照し、
  # 名称・ICD10 は表示用に写しておく(マスタ差し替え後も一覧が出せるように)。
  def change
    create_table :master_regimen_indications do |t|
      t.string :regimen_code, null: false
      t.integer :display_order
      t.string :management_number, null: false
      t.string :name, null: false
      t.string :icd10
      t.timestamps
    end
    add_index :master_regimen_indications, :regimen_code
  end
end
