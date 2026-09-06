class CreateMasterCtcaeTerms < ActiveRecord::Migration[8.0]
  def change
    create_table :master_ctcae_terms do |t|
      # MedDRA の下層語コード(8 桁)。配布ファイル内で一意。
      t.string :meddra_code, null: false
      # 器官別大分類(SOC)。
      t.string :soc_en
      t.string :soc_ja
      # 有害事象の用語。
      t.string :term_en
      t.string :term_ja, null: false
      # Grade 1〜5 の定義。該当のない Grade は空(配布ファイルの "-")。
      t.text :grade1_en
      t.text :grade1_ja
      t.text :grade2_en
      t.text :grade2_ja
      t.text :grade3_en
      t.text :grade3_ja
      t.text :grade4_en
      t.text :grade4_ja
      t.text :grade5_en
      t.text :grade5_ja
      # 用語の定義。
      t.text :definition_en
      t.text :definition_ja
      # 検索上の注意(Navigational Note)。
      t.text :navigational_note_en
      t.text :navigational_note_ja
      # 配布ファイルのソート用 ID。SOC の収載順に並べるのに使う。
      t.integer :display_order
      # 表記ゆれを吸収した検索用(SearchNormalizer)。
      t.string :search_term
      t.string :search_soc

      t.timestamps
    end

    add_index :master_ctcae_terms, :meddra_code, unique: true
    add_index :master_ctcae_terms, :search_term
    add_index :master_ctcae_terms, :soc_ja
  end
end
