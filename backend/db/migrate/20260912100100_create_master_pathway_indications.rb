class CreateMasterPathwayIndications < ActiveRecord::Migration[8.0]
  # パスの対象病名(ePath の goal.addresses)。病名マスタの管理番号で参照し、
  # 名称・ICD10 は表示用に写す(レジメンの適応疾患と同じ)。
  def change
    create_table :master_pathway_indications do |t|
      t.string :pathway_code, null: false
      t.integer :display_order
      t.string :management_number, null: false
      t.string :name, null: false
      t.string :icd10
      t.timestamps
    end
    add_index :master_pathway_indications, :pathway_code
  end
end
