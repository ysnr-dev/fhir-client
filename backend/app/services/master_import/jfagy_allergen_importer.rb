require "csv"

module MasterImport
  # Parses the J-FAGY allergen code CSV (JFAGYコード表, UTF-8,
  # header row + 11 columns) and replaces master_jfagy_allergens wholesale
  # within one transaction.
  class JfagyAllergenImporter
    EXPECTED_COLUMNS = 11
    COLUMNS = %i[
      display_seq jfagy_code name name_kana name_en
      level main_flag guideline cxg_category
      record_date end_date
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
        Master::JfagyAllergen.delete_all
        rows.each_slice(1000) { |slice| Master::JfagyAllergen.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def parse_rows
      now = Time.current
      # 検査項目マスタと同じく UTF-8(BOM 付き)で配布される。
      csv_text = file.read.force_encoding("UTF-8").delete_prefix("\xEF\xBB\xBF")

      CSV.parse(csv_text, headers: true).map.with_index do |row, index|
        values = row.fields

        if values.size != EXPECTED_COLUMNS
          raise ImportError, "row #{index + 2}: expected #{EXPECTED_COLUMNS} columns, got #{values.size}"
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
