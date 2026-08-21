module MasterImport
  # Parses the MEDIS disease index table (index518.txt 等, Shift_JIS, no header,
  # 9 columns) and replaces master_disease_indexes wholesale within one
  # transaction. 約11万件と大きいため 1000 件ずつ bulk insert する。
  class DiseaseIndexImporter < CsvImporter
    self.model = Master::DiseaseIndex
    self.columns = %i[
      term target_code disease_modifier_category kana_kanji_category
      synonym_category variant_category first_edition_category
      language_category abbreviation_category
    ].freeze
    self.search_columns = { search_term: :term }.freeze
  end
end
