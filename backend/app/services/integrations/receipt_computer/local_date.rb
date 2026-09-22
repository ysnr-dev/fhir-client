module Integrations
  module ReceiptComputer
    # FHIR の日時を診療日(日本の暦日)に丸める。
    #
    # 上流の日付検索はタイムゾーン無しの値を Asia/Tokyo で解釈するので検索はそのままでよいが、
    # 返ってきたリソースの日時はオフセット付きの文字列なので、日付だけ比べるときは
    # 一度日本時間に直す(UTC の日付で比べると深夜の実施が前日に寄る)。
    module LocalDate
      ZONE = ActiveSupport::TimeZone["Asia/Tokyo"]

      module_function

      # "2026-09-20" / "2026-09-20T01:00:00+09:00" / "2026-09-19T16:30:00Z" → "2026-09-20"
      def of(value)
        text = value.to_s
        return nil if text.blank?
        return text if text.length == 10

        Time.iso8601(text).in_time_zone(ZONE).strftime("%F")
      rescue ArgumentError
        text[0, 10]
      end

      # 「その日に始まった」を表す FHIR の日付検索の値。date=<日付> の等価検索は期間の終了が
      # 無い(開始だけの)リソースに当たらないので、sa(前日より後に始まる)と le(その日までに
      # 始まる)を並べる。同じキーの複数値は AND(FhirStore#encode が繰り返しに展開する)。
      def starts_on(date)
        day = Date.parse(date.to_s)
        ["sa#{day - 1}", "le#{day}"]
      end

      # "2026-09-20T10:30:00+09:00" → "10:30"。日付だけの値には時刻が無い。
      def time_of(value)
        text = value.to_s
        return nil if text.length <= 10

        Time.iso8601(text).in_time_zone(ZONE).strftime("%H:%M")
      rescue ArgumentError
        nil
      end
    end
  end
end
