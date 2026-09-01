module Reports
  # 注射オーダー(ServiceRequest)から帳票に刷る表示値を取り出す共通処理。
  # 注射箋と注射ラベルで同じ規約を使う。
  module InjectionMeta
    module_function

    # 「入院 臨時」のような区分表示(入外区分 + 注射区分)。
    def category_display(order)
      Array(order["category"]).filter_map do |category|
        Array(category["coding"]).find do |coding|
          [InjectionReport::SETTING_SYSTEM, InjectionReport::INJECTION_CATEGORY_SYSTEM].include?(coding["system"])
        end&.dig("display")
      end.join(" ")
    end

    def department_name(order)
      extension_reference_display(order, InjectionReport::ORDER_DEPARTMENT_EXT_URL)
    end

    def ward_name(order)
      extension_reference_display(order, InjectionReport::ORDER_WARD_EXT_URL)
    end

    def extension_reference_display(order, url)
      ext = Array(order["extension"]).find { |e| e["url"] == url }
      ext&.dig("valueReference", "display").to_s
    end

    # 連日オーダーの「連日 3日目(8/30〜)」「隔日(8/30〜)」。frontend の injectionSeriesLabel と
    # 同じ規則: 毎日は開始日からの日数で「N日目」、間引きのあるパターンはパターン名だけ。
    # 開始日そのもの(毎日)は単日と見分けが付かないので空。
    # 「N日目」の起点はこのオーダーの注射日(occurrenceDateTime)であって登録日時ではない。
    def series_label(order)
      start = Array(order["extension"]).find { |e| e["url"] == InjectionReport::SERIES_START_EXT_URL }
                                       &.dig("valueDate")
      date = OrderDates.order_day(order)
      return "" if start.blank? || date.blank?

      from = "#{Date.parse(start).month}/#{Date.parse(start).day}〜"
      repeat = Array(order["extension"]).find { |e| e["url"] == InjectionReport::SERIES_SCHEDULE_EXT_URL }
                                        &.dig("valueTiming", "repeat")
      if repeat.nil?
        day = (Date.parse(date) - Date.parse(start)).to_i + 1
        return day == 1 ? "" : "連日 #{day}日目(#{from})"
      end
      "#{schedule_label(repeat)}(#{from})"
    rescue ArgumentError
      ""
    end

    DAY_LABELS = { "mon" => "月", "tue" => "火", "wed" => "水", "thu" => "木",
                   "fri" => "金", "sat" => "土", "sun" => "日" }.freeze

    def schedule_label(repeat)
      days = Array(repeat["dayOfWeek"])
      if days.any?
        labels = DAY_LABELS.keys.select { |k| days.include?(k) }.map { |k| DAY_LABELS[k] }
        return "毎週 #{labels.join('・')}"
      end
      period = repeat["period"].to_i
      return "隔日" if period == 2

      period > 1 ? "#{period}日ごと" : "毎日"
    end

    # 用法 1 行(「点滴 | 静脈注射 | 静脈内 | 左前腕 | 末梢ルート | 100mL/h」)。
    # frontend の injectionUsageSummary と同じ並び。
    def usage_summary(rp)
      [rp.usage_type, rp.method, rp.route, rp.site, rp.line,
       rp.rate.present? ? "#{rp.rate}mL/h" : nil].compact_blank.join(" | ")
    end
  end
end
