require "roo"
require "tempfile"

module MasterImport
  # Parses the medicine usage master (.xlsx, first sheet "電子処方箋用法マスタ").
  # Data rows start at row 5 (rows 1-2 are a two-line header, 3-4 are blank);
  # column A (usage_code) blank marks the end of data.
  class MedicineUsageImporter
    FIRST_DATA_ROW = 5
    EXPECTED_COLUMNS = 12
    COLUMNS = %i[
      usage_code basic_usage_category_code basic_usage_category
      detailed_usage_category_code detailed_usage_category
      timing_category_code timing_category
      usage_name standard_usage_number start_date end_date usage_code_category
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
        Master::MedicineUsage.delete_all
        rows.each_slice(1000) { |slice| Master::MedicineUsage.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def parse_rows
      now = Time.current

      Tempfile.create(["medicine_usages", ".xlsx"], binmode: true) do |tmp|
        tmp.write(file.read)
        tmp.flush

        workbook = Roo::Excelx.new(tmp.path)
        sheet = workbook.sheet(workbook.sheets.first)

        (FIRST_DATA_ROW..sheet.last_row).filter_map do |row_index|
          values = (1..EXPECTED_COLUMNS).map { |col| sheet.cell(row_index, col) }
          next if values.first.blank?

          attrs = COLUMNS.zip(values.map { |v| v.nil? ? nil : v.to_s }).to_h
          # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
          attrs[:search_name] = Master::SearchNormalizer.normalize(attrs[:usage_name])
          attrs.merge(created_at: now, updated_at: now)
        end
      end
    end
  end
end
