module MasterImport
  # Parses the medicine master CSV (y_r07_ALL*.csv, no header row, 42 columns)
  # and replaces master_medicines wholesale within one transaction.
  class MedicineImporter < CsvImporter
    self.model = Master::Medicine
    self.columns = %i[
      change_category master_type medicine_code
      name_kanji_length name name_kana_length name_kana
      unit_code unit_name_length unit_name
      price_type price
      reserve1 narcotic_category nerve_destruction_flag biological_product_flag generic_flag
      reserve2 dental_specific_flag contrast_medium_category injection_volume listing_method_category
      brand_name_related_code
      old_price_type old_price
      name_change_flag kana_change_flag dosage_form reserve3
      changed_on abolished_on yakka_code publication_order transitional_measure_on
      basic_name
      listed_on generic_name_code generic_name_description generic_name_addition_category
      anti_hiv_flag long_term_listed_related_code selective_treatment_category
    ].freeze
    self.decimal_columns = %i[price old_price].freeze
    self.search_columns = {
      search_name: :name,
      search_kana: :name_kana,
      search_generic: :generic_name_description
    }.freeze
  end
end
