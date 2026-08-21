module MasterImport
  # Parses the MEDIS modifier master (mdfy518.txt 等, Shift_JIS, no header,
  # 10 columns) and replaces master_modifiers wholesale within one transaction.
  class ModifierImporter < CsvImporter
    self.model = Master::Modifier
    self.columns = %i[
      change_category management_number name name_kana exchange_code
      connection_position_category modifier_category exclusive_group_code
      receipt_code description_label
    ].freeze
    self.search_columns = { search_name: :name, search_kana: :name_kana }.freeze
  end
end
