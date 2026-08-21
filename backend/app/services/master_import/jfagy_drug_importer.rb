module MasterImport
  # Parses the J-FAGY 剤形・規格・銘柄不明コードマスタ CSV (UTF-8,
  # header row + 6 columns) and replaces master_jfagy_drugs wholesale
  # within one transaction.
  class JfagyDrugImporter < CsvImporter
    self.model = Master::JfagyDrug
    self.encoding = :utf8
    self.headers = true
    # 3列目は配布ファイル上「(空欄)」の予備列のため取り込まない。
    self.columns = %i[jfagy_code name reserved record_date end_date change_category].freeze
    self.dropped_columns = %i[reserved].freeze
    self.search_columns = { search_name: :name }.freeze
  end
end
