class CreateMasterBomMasters < ActiveRecord::Migration[8.0]
  # BOM(Basic Outcome Master®、日本クリニカルパス学会)のアウトカムと観察項目。
  # 配布ファイルは学会の知財なので同梱せず、施設が取り込む(docs/clinical-pathway-design.md §3.3)。
  def change
    create_table :master_bom_outcomes do |t|
      t.string :manage_no
      # 大分類(G 患者目標 / H 患者状態)・中分類(H013 循環 など)。
      t.string :category_code
      t.string :category_name
      t.string :subcategory_code
      t.string :subcategory_name
      t.string :outcome_code, null: false
      t.string :outcome_name, null: false
      t.integer :display_order
      t.string :search_name
      t.timestamps
    end
    add_index :master_bom_outcomes, :outcome_code, unique: true
    add_index :master_bom_outcomes, :search_name, opclass: :gin_trgm_ops, using: :gin
    add_index :master_bom_outcomes, :category_code

    create_table :master_bom_assessments do |t|
      t.string :manage_no
      # 観察項目分類(19 バイタルサイン など)。
      t.string :category_code
      t.string :category_name
      t.string :assessment_code, null: false
      t.string :name, null: false
      t.string :name2
      # MEDIS 看護観察の管理番号と名称(評価入力の表現タイプを借りる結び)。
      t.string :medis_manage_no
      t.string :medis_name
      t.integer :display_order
      t.string :search_name
      t.timestamps
    end
    add_index :master_bom_assessments, :assessment_code, unique: true
    add_index :master_bom_assessments, :search_name, opclass: :gin_trgm_ops, using: :gin
    add_index :master_bom_assessments, :category_code

    # OAT ユニットの BOM 中分類(ePath の BOM 中分類コード・名称)。
    add_column :master_pathway_oat_units, :subcategory_code, :string
    add_column :master_pathway_oat_units, :subcategory_name, :string
  end
end
