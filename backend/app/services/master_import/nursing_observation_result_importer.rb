module MasterImport
  # 看護観察編 観察結果テーブル(result-ver.*.txt、cp932、ヘッダあり、3 列)。
  class NursingObservationResultImporter < CsvImporter
    self.model = Master::NursingObservationResult
    self.headers = true
    self.columns = %i[result_group_code result_code name].freeze
  end
end
