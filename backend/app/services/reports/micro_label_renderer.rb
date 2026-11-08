module Reports
  # 細菌検査の検体ラベル(docs/report-mappings/micro-label-01.md)。共通部は ContainerLabelRenderer。
  #   specimen_label ... 「喀出痰 右 耳」(検体 + 採取部位)
  #   specimen_detail ... 検体の容器は「吸引 塗抹/培養」(採取方法 + 項目の略称)、ボトルは項目名
  #   order_date ... 採取を記録していれば「採取 2026/11/06 10:15」、まだなら採取予定日時で
  #                  「予定 2026/11/05 10:00」(時刻が未定ならオーダーの検査日)
  class MicroLabelRenderer < ContainerLabelRenderer
    private

    def specimen_label(label)
      label.specimen
    end

    def date_label(label)
      return "採取 #{date_time(label.collected)}" if label.collected.present?

      "予定 #{date_time(label.planned.presence || OrderDates.order_day(@order))}"
    end

    # 時刻を持つ値は日本時間で「YYYY/MM/DD HH:MM」、日付だけならその日付(オーダーの検査日を写したもの)。
    def date_time(value)
      return PatientMeta.format_date(value[0, 10]) if value.length <= 10

      Time.zone.parse(value).in_time_zone(FacilityClock::ZONE).strftime("%Y/%m/%d %H:%M")
    end
  end
end
