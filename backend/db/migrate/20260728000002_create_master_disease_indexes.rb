class CreateMasterDiseaseIndexes < ActiveRecord::Migration[7.0]
  def change
    create_table :master_disease_indexes do |t|
      t.string :term, null: false
      t.string :target_code, null: false
      t.string :disease_modifier_category
      t.string :kana_kanji_category
      t.string :synonym_category
      t.string :variant_category
      t.string :first_edition_category
      t.string :language_category
      t.string :abbreviation_category

      t.string :search_term

      t.timestamps
    end

    add_index :master_disease_indexes, :target_code
    add_index :master_disease_indexes, :search_term
  end
end
