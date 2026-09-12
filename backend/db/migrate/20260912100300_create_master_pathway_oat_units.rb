class CreateMasterPathwayOatUnits < ActiveRecord::Migration[8.0]
  # OAT ユニット = 1 つのアウトカム(O)と、それを判定する観察項目(A)・実施するタスク(T)の
  # 束(ePath の最小の臨床単位)。unit_key は適用後データ(CarePlan)まで持ち越す識別子で、
  # 子を丸ごと置換しても変わらない。複製したパスにも同じ値を写すので、一意性はパス内。
  def change
    create_table :master_pathway_oat_units do |t|
      t.string :pathway_code, null: false
      t.bigint :event_id, null: false
      t.integer :display_order
      t.string :unit_key, null: false                 # OAT ユニット識別子(uuid)
      t.string :name, null: false                     # アウトカム名
      t.string :category                              # G 患者目標 / H 患者状態
      t.string :code_system                           # bom / local
      t.string :code                                  # アウトカムコード
      t.boolean :critical, null: false, default: false # 重要アウトカム
      t.text :note
      t.timestamps
    end
    add_index :master_pathway_oat_units, %i[pathway_code unit_key], unique: true
    add_index :master_pathway_oat_units, :event_id
  end
end
