module MasterImport
  # Parses the MEDIS disease master (nmain518.txt 等, Shift_JIS, no header,
  # 20 columns) and replaces master_diseases wholesale within one transaction.
  class DiseaseImporter < CsvImporter
    self.model = Master::Disease
    self.columns = %i[
      change_category management_number name name_kana adoption_category exchange_code
      icd10_2013 icd10_2013_secondary reserve1 reserve2
      receipt_code abbreviated_name usage_field
      change_history_number updated_on transfer_management_number
      single_use_prohibited_category non_billable_category reserve3 reserve4
    ].freeze
    self.search_columns = { search_name: :name, search_kana: :name_kana }.freeze
  end
end
