require "csv"

module MasterImport
  # Parses the lab item master CSV (共有項目JLACコードマスタ, UTF-8,
  # header row + 32 columns) and replaces master_lab_items wholesale
  # within one transaction.
  class LabItemImporter
    EXPECTED_COLUMNS = 32
    COLUMNS = %i[
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
        Master::LabItem.delete_all
        rows.each_slice(1000) { |slice| Master::LabItem.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def parse_rows
      now = Time.current
      # 医薬品系マスタ(Shift_JIS)と異なり、このマスタは UTF-8 で配布される。
      csv_text = file.read.force_encoding("UTF-8").delete_prefix("\xEF\xBB\xBF")

      CSV.parse(csv_text, headers: true).map.with_index do |row, index|
        values = row.fields

        if values.size != EXPECTED_COLUMNS
          raise ImportError, "row #{index + 2}: expected #{EXPECTED_COLUMNS} columns, got #{values.size}"
        end

        attrs = COLUMNS.zip(values).to_h
        # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
        attrs[:search_name] = Master::SearchNormalizer.normalize(attrs[:fhir_item_name])
        attrs[:search_abbreviation] = Master::SearchNormalizer.normalize(attrs[:abbreviation])
        attrs.merge(created_at: now, updated_at: now)
      end
    end
  end
end
