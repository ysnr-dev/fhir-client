module LabImport
  # HL7 の TS(タイムスタンプ)を Time / Date にする。
  #
  # JAHIS のファイルはタイムゾーンを持たない現地時刻で来る。アプリの
  # config.time_zone は未設定(UTC)なので、明示しないと 9 時間ずれる。
  module Hl7Time
    ZONE = "Asia/Tokyo".freeze
    PATTERN = /\A(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?([+-]\d{4})?/

    module_function

    def parse(value)
      match = PATTERN.match(value.to_s.strip)
      return nil if match.nil?

      year, month, day, hour, minute, second, offset = match.captures
      parts = [year.to_i, (month || "01").to_i, (day || "01").to_i,
               hour.to_i, minute.to_i, second.to_i]
      return nil unless valid?(parts)

      if offset
        Time.new(*parts, "#{offset[0, 3]}:#{offset[3, 2]}")
      else
        zone.local(*parts)
      end
    rescue ArgumentError, RangeError
      nil
    end

    def parse_date(value)
      match = PATTERN.match(value.to_s.strip)
      return nil if match.nil? || match[2].nil? || match[3].nil?

      Date.new(match[1].to_i, match[2].to_i, match[3].to_i)
    rescue Date::Error
      nil
    end

    def zone
      ActiveSupport::TimeZone[ZONE]
    end

    def valid?(parts)
      year, month, day = parts
      year.positive? && month.between?(1, 12) && day.between?(1, 31)
    end
  end
end
