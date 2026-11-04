module Ssmix2
  module Hl7
    # HL7 の TS(タイムスタンプ)。SS-MIX2 はタイムゾーンを付けない日本時間で書く。
    # FHIR の date / dateTime(オフセット付き)を受け、精度に応じて桁を落とす。
    module Stamp
      ZONE = ActiveSupport::TimeZone["Asia/Tokyo"]
      DATE_ONLY = /\A\d{4}(-\d{2}(-\d{2})?)?\z/

      module_function

      # precision は :day / :minute / :second / :millisecond。日付しか無い値は精度に関わらず日付で返す。
      def format(value, precision: :second)
        time = coerce(value)
        return "" if time.nil?
        return time.strftime("%Y%m%d") if time.is_a?(Date) && !time.is_a?(DateTime)

        case precision
        when :day then time.strftime("%Y%m%d")
        when :minute then time.strftime("%Y%m%d%H%M")
        when :millisecond then time.strftime("%Y%m%d%H%M%S.%L")
        else time.strftime("%Y%m%d%H%M%S")
        end
      end

      # 日付。FHIR の年だけ・年月だけの値は、その精度のまま(YYYY / YYYYMM)にする。
      def day(value)
        text = value.to_s.strip
        return text.delete("-") if value.is_a?(String) && text.match?(DATE_ONLY)

        format(value, precision: :day)
      end

      def now = ZONE.now

      # FHIR の date / dateTime / instant を日本時間に直す。日付だけなら Date。
      def coerce(value)
        case value
        when nil then nil
        when Date then value
        when ::Time, ActiveSupport::TimeWithZone, DateTime then value.in_time_zone(ZONE)
        else
          text = value.to_s.strip
          return nil if text.empty?
          return parse_date(text) if text.match?(DATE_ONLY)

          ZONE.parse(text)
        end
      rescue ArgumentError
        nil
      end

      def parse_date(text)
        parts = text.split("-").map(&:to_i)
        Date.new(parts[0], parts[1] || 1, parts[2] || 1)
      rescue Date::Error
        nil
      end
    end
  end
end
