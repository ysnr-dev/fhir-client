module MasterImport
  # 看護観察編 単位テーブル(unit-ver.*.txt、cp932、ヘッダあり、2 列)。
  class NursingUnitImporter < CsvImporter
    self.model = Master::NursingUnit
    self.headers = true
    self.columns = %i[unit_code name].freeze
  end
end
