require "csv"

module MasterImport
  # Parses the medicine master CSV (y_r07_ALL*.csv, no header row, 42 columns)
  # and replaces master_medicines wholesale within one transaction.
  class MedicineImporter
    EXPECTED_COLUMNS = 42
    COLUMNS = %i[
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
    DECIMAL_COLUMNS = %i[price old_price].freeze

    Result = Struct.new(:imported_count, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      rows = parse_rows

      ActiveRecord::Base.transaction do
        Master::Medicine.delete_all
        rows.each_slice(1000) { |slice| Master::Medicine.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def parse_rows
      now = Time.current
      csv_text = file.read.force_encoding("CP932").encode("UTF-8")

      CSV.parse(csv_text, headers: false).map.with_index do |row, index|
        values = row.to_a

        if values.size != EXPECTED_COLUMNS
          raise ImportError, "row #{index + 1}: expected #{EXPECTED_COLUMNS} columns, got #{values.size}"
        end

        attrs = COLUMNS.zip(values).to_h
        DECIMAL_COLUMNS.each { |col| attrs[col] = attrs[col].presence }
        attrs.merge(created_at: now, updated_at: now)
      end
    end
  end
end
