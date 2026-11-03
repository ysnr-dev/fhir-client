class CreateMasterBomPairs < ActiveRecord::Migration[8.0]
  # BOM の OAT の組(アウトカム → 観察項目)。配布ファイルの本体シートは 1 行がこの組で、
  # アウトカムを選んだときに観察項目をまとめて入れるのに使う(docs/clinical-pathway-design.md §3.3)。
  def change
    create_table :master_bom_pairs do |t|
      t.string :outcome_code, null: false
      t.string :assessment_code, null: false
      # 観察項目マスターに無いコードのための名称(配布ファイルの組み合わせ行の名称)。
      t.string :assessment_name
      t.integer :display_order
      t.timestamps
    end
    add_index :master_bom_pairs, %i[outcome_code assessment_code], unique: true
  end
end
