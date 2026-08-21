module MasterImport
  # Parses the J-FAGY allergen code CSV (JFAGYコード表, UTF-8,
  # header row + 11 columns) and replaces master_jfagy_allergens wholesale
  # within one transaction.
  class JfagyAllergenImporter < CsvImporter
    self.model = Master::JfagyAllergen
    self.encoding = :utf8
    self.headers = true
    self.columns = %i[
      display_seq jfagy_code name name_kana name_en
      level main_flag guideline cxg_category
      record_date end_date
    ].freeze
    self.search_columns = { search_name: :name, search_kana: :name_kana }.freeze
  end
end
