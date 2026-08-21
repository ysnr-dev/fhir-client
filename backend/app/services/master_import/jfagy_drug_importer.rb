require "csv"

module MasterImport
  # Parses the J-FAGY 剤形・規格・銘柄不明コードマスタ CSV (UTF-8,
  # header row + 6 columns) and replaces master_jfagy_drugs wholesale
  # within one transaction.
  class JfagyDrugImporter
    EXPECTED_COLUMNS = 6
    # 3列目は配布ファイル上「(空欄)」の予備列のため取り込まない。
    COLUMNS = %i[jfagy_code name reserved record_date end_date change_category].freeze

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
        Master::JfagyDrug.delete_all
        rows.each_slice(1000) { |slice| Master::JfagyDrug.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def parse_rows
      now = Time.current
      # UTF-8 で配布される(BOM が付いても剥がせるようにしておく)。
      csv_text = file.read.force_encoding("UTF-8").delete_prefix("\xEF\xBB\xBF")

      CSV.parse(csv_text, headers: true).map.with_index do |row, index|
        values = row.fields

        if values.size != EXPECTED_COLUMNS
          raise ImportError, "row #{index + 2}: expected #{EXPECTED_COLUMNS} columns, got #{values.size}"
        end

        attrs = COLUMNS.zip(values).to_h
        attrs.delete(:reserved)
        # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
        attrs[:search_name] = Master::SearchNormalizer.normalize(attrs[:name])
        attrs.merge(created_at: now, updated_at: now)
      end
    end
  end
end
