module Reports
  # 病理検体ラベル(docs/report-mappings/patho-label-01.md)。共通部は ContainerLabelRenderer。
  #   specimen_label ... 「検体1 右 胃前庭部」
  #   specimen_detail ... 「組織診・生検・EMR・3個」
  #   order_date ... 「採取 2026/11/01」(未採取ならオーダーの採取予定日で「予定 …」)
  class PathoLabelRenderer < ContainerLabelRenderer
    private

    def specimen_label(label)
      ["検体#{label.specimen_number}", label.organ.presence || "臓器未設定"].join(" ")
    end

    # 採取を記録していれば採取日、まだならオーダーの採取予定日。
    def date_label(label)
      if label.collected.present?
        "採取 #{PatientMeta.format_date(label.collected[0, 10])}"
      else
        "予定 #{PatientMeta.format_date(OrderDates.order_day(@order))}"
      end
    end
  end
end
