module MasterImport
  # ATC 分類の取込。ファイルは rake medicine_ingredients:generate が作る(UTF-8、ヘッダーあり、2 列)。
  class AtcClassImporter < CsvImporter
    self.model = Master::AtcClass
    self.encoding = :utf8
    self.headers = true
    self.columns = %i[code name].freeze
  end
end
