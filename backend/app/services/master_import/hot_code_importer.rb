require "csv"

module MasterImport
  # Parses MEDISyyyymmdd_HOT9.TXT (medicine HOT code master) and replaces
  # master_hot_codes wholesale within one transaction (delete-all + bulk insert).
  class HotCodeImporter
    EXPECTED_COLUMNS = 24
    COLUMNS = %i[
      hot_code hot7_code company_identification_number dispensing_number logistics_number
      jan_code yakka_code individual_medicine_code receipt_code_1 receipt_code_2
      notification_name sales_name receipt_medicine_name standard_unit package_form
      package_unit_quantity package_unit_unit package_total_quantity package_total_unit
      category manufacturer distributor update_category updated_on
    ].freeze
    DECIMAL_COLUMNS = %i[package_unit_quantity package_total_quantity].freeze

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
        Master::HotCode.delete_all
        rows.each_slice(1000) { |slice| Master::HotCode.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def parse_rows
      now = Time.current
      csv_text = file.read.force_encoding("CP932").encode("UTF-8")

      CSV.parse(csv_text, headers: true).map.with_index do |row, index|
        values = row.fields

        if values.size != EXPECTED_COLUMNS
          raise ImportError, "row #{index + 2}: expected #{EXPECTED_COLUMNS} columns, got #{values.size}"
        end

        attrs = COLUMNS.zip(values).to_h
        DECIMAL_COLUMNS.each { |col| attrs[col] = attrs[col].presence }
        attrs.merge(created_at: now, updated_at: now)
      end
    end
  end
end
