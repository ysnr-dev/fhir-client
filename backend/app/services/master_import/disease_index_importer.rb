require "csv"

module MasterImport
  # Parses the MEDIS disease index table (index518.txt 等, Shift_JIS, no header,
  # 9 columns) and replaces master_disease_indexes wholesale within one
  # transaction. 約11万件と大きいため 1000 件ずつ bulk insert する。
  class DiseaseIndexImporter
    EXPECTED_COLUMNS = 9
    COLUMNS = %i[
      term target_code disease_modifier_category kana_kanji_category
      synonym_category variant_category first_edition_category
      language_category abbreviation_category
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
        Master::DiseaseIndex.delete_all
        rows.each_slice(1000) { |slice| Master::DiseaseIndex.insert_all!(slice) }
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
        attrs[:search_term] = Master::SearchNormalizer.normalize(attrs[:term])
        attrs.merge(created_at: now, updated_at: now)
      end
    end
  end
end
