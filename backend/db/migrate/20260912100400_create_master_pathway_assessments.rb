class CreateMasterPathwayAssessments < ActiveRecord::Migration[8.0]
  # 観察項目(アウトカムを判定するための観察・アセスメント)。コードは BOM でも施設ローカルでも
  # よく、空なら ePath 出力時に「観察項目なし」の固定コードを出す。看護観察の管理番号は、
  # 適用後の評価入力で MEDIS の表現タイプ(数値・列挙…)を借りるための任意の結び。
  def change
    create_table :master_pathway_assessments do |t|
      t.string :pathway_code, null: false
      t.bigint :unit_id, null: false
      t.integer :display_order
      t.string :assessment_key, null: false           # 観察項目識別子(uuid)
      t.string :name, null: false
      t.string :category_code                         # 観察項目分類コード(BOM: 19 バイタルサイン など)
      t.string :category_name
      t.string :code_system                           # bom / local
      t.string :code
      t.string :proper_value                          # 適正値(評価基準)
      t.string :nursing_observation_manage_no         # MEDIS 看護観察の管理番号(任意)
      t.text :note
      t.timestamps
    end
    add_index :master_pathway_assessments, %i[pathway_code assessment_key], unique: true
    add_index :master_pathway_assessments, :unit_id
  end
end
