require "csv"

module MasterImport
  # Parses the MEDIS disease master (nmain518.txt 等, Shift_JIS, no header,
  # 20 columns) and replaces master_diseases wholesale within one transaction.
  class DiseaseImporter
    EXPECTED_COLUMNS = 20
    COLUMNS = %i[
      change_category management_number name name_kana adoption_category exchange_code
      icd10_2013 icd10_2013_secondary reserve1 reserve2
      receipt_code abbreviated_name usage_field
      change_history_number updated_on transfer_management_number
      single_use_prohibited_category non_billable_category reserve3 reserve4
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
        Master::Disease.delete_all
        rows.each_slice(1000) { |slice| Master::Disease.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def parse_rows
      now = Time.current
      # 仕様書の指定どおり Windows-31J(CP932) を変換元として UTF-8 化する。
      csv_text = file.read.force_encoding("CP932").encode("UTF-8")

      CSV.parse(csv_text, headers: false).map.with_index do |row, index|
        values = row.to_a

        if values.size != EXPECTED_COLUMNS
          raise ImportError, "row #{index + 1}: expected #{EXPECTED_COLUMNS} columns, got #{values.size}"
        end

        attrs = COLUMNS.zip(values).to_h
        # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
        attrs[:search_name] = Master::SearchNormalizer.normalize(attrs[:name])
        attrs[:search_kana] = Master::SearchNormalizer.normalize(attrs[:name_kana])
        attrs.merge(created_at: now, updated_at: now)
      end
    end
  end
end
