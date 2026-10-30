require "csv"

module MasterImport
  # 内閣府「国民の祝日」CSV(syukujitsu.csv、Shift_JIS、ヘッダあり・2 列、日付は 2027/1/1 形式)。
  # ファイルが覆う期間の国民の祝日だけを入れ替え、施設の休診日には触れない。
  # 施設の休診日と同じ日の祝日は取り込まない(1 日 1 行。休診日の名称を残す)。
  class HolidayImporter
    Result = Struct.new(:imported_count, :skipped_count, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      rows = parse
      raise ImportError, "祝日の行がありません" if rows.empty?

      range = rows.map { |r| r[:holiday_date] }.minmax
      facility_dates = Master::Holiday.where(kind: "facility", holiday_date: range[0]..range[1]).pluck(:holiday_date).to_set
      imported = rows.reject { |r| facility_dates.include?(r[:holiday_date]) }

      now = Time.current
      ActiveRecord::Base.transaction do
        Master::Holiday.where(kind: "national", holiday_date: range[0]..range[1]).delete_all
        Master::Holiday.insert_all!(imported.map { |r| r.merge(kind: "national", created_at: now, updated_at: now) })
      end

      Result.new(imported_count: imported.size, skipped_count: rows.size - imported.size)
    end

    private

    def parse
      text = @file.read.force_encoding("CP932").encode("UTF-8").delete_prefix("﻿")
      CSV.parse(text, headers: true).each_with_index.map do |row, index|
        date_text, name = row.fields.map { |v| v.to_s.strip }
        date = begin
          Date.strptime(date_text, "%Y/%m/%d")
        rescue Date::Error
          raise ImportError, "row #{index + 2}: 日付が読めません(#{date_text})"
        end
        raise ImportError, "row #{index + 2}: 名称がありません" if name.blank?

        { holiday_date: date, name: name }
      end.uniq { |r| r[:holiday_date] }
    rescue Encoding::UndefinedConversionError, Encoding::InvalidByteSequenceError
      raise ImportError, "Shift_JIS の CSV ではありません"
    end
  end
end
