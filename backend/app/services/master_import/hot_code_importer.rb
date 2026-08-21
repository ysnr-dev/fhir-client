module MasterImport
  # Parses MEDISyyyymmdd_HOT9.TXT (medicine HOT code master) and replaces
  # master_hot_codes wholesale within one transaction (delete-all + bulk insert).
  class HotCodeImporter < CsvImporter
    self.model = Master::HotCode
    self.headers = true
    self.columns = %i[
      hot_code hot7_code company_identification_number dispensing_number logistics_number
      jan_code yakka_code individual_medicine_code receipt_code_1 receipt_code_2
      notification_name sales_name receipt_medicine_name standard_unit package_form
      package_unit_quantity package_unit_unit package_total_quantity package_total_unit
      category manufacturer distributor update_category updated_on
    ].freeze
    self.decimal_columns = %i[package_unit_quantity package_total_quantity].freeze
  end
end
