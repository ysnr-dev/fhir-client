module MasterImport
  # Parses the lab item master CSV (共有項目JLACコードマスタ, UTF-8,
  # header row + 32 columns) and replaces master_lab_items wholesale
  # within one transaction.
  class LabItemImporter < CsvImporter
    self.model = Master::LabItem
    # 医薬品系マスタ(Shift_JIS)と異なり、このマスタは UTF-8 で配布される。
    self.encoding = :utf8
    self.headers = true
    self.columns = %i[
      category_name reserve_category_name emergency_flag lifestyle_disease_flag data_category
      major_item fhir_item_name fhir_identifier abbreviation sales_name
      jlac11_specimen jlac11_method jlac11_code
      display_unit display_unit2 xml_unit xml_unit2
      jlac10_specimen jlac10_method jlac10_code
      reference_lower_flag reference_upper_flag reference_judgment_flag
      data_type value_lower_limit value_upper_limit numeric_format
      code_value_list code_oid
      display_order start_date end_date
    ].freeze
    self.search_columns = {
      search_name: :fhir_item_name,
      search_abbreviation: :abbreviation,
      search_major_item: :major_item
    }.freeze
  end
end
