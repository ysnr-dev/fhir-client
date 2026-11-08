module Ssmix2
  module Cda
    # CDA の TS。日本時間にオフセットを付けて YYYYMMDDHHMMSS+0900、日付だけの値はその精度のまま。
    module Timestamp
      module_function

      def format(value)
        time = Hl7::Stamp.coerce(value)
        return "" if time.nil?
        return Hl7::Stamp.day(value) if time.is_a?(Date) && !time.is_a?(DateTime)

        time.strftime("%Y%m%d%H%M%S%z")
      end

      # コンテンツ定義ファイルの createDateTime(W3C XML Schema の dateTime)。
      def xsd(value)
        time = Hl7::Stamp.coerce(value)
        time.respond_to?(:iso8601) ? time.iso8601 : ""
      end
    end
  end
end
