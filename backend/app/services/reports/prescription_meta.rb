module Reports
  # 処方箋(PDF と QR コード)が共通で読むオーダー・自院の値。紙の欄と QR の記録で
  # 同じ値を使うために 1 か所にまとめる。
  module PrescriptionMeta
    module_function

    # 交付年月日は登録日時(authoredOn)の日付。オーダー開始日(投与開始日 = occurrenceDateTime)
    # ではない。発行操作の日でもないので、再発行しても同じ日付が刷られる
    # (docs/prescription-report-design.md)。化学療法レジメンの日オーダーは数クール分を先に
    # 登録し、投与日に渡すので投与開始日にする(frontend の summarizeServiceRequest と同じ)。
    def issue_date(order)
      if order.dig("requisition", "system") == PrescriptionReport::REGIMEN_INSTANCE_SYSTEM
        order["occurrenceDateTime"].to_s.first(10)
      else
        order["authoredOn"].to_s.first(10)
      end
    end

    def department_name(order)
      extension = Array(order["extension"]).find do |ext|
        ext["url"] == PrescriptionReport::ORDER_DEPARTMENT_EXT_URL
      end
      extension&.dig("valueReference", "display").to_s
    end

    def doctor_name(order)
      order.dig("requester", "display").to_s
    end

    # 化学療法の日オーダー(内服)なら備考の先頭に「化学療法: CapeOX C1 Day1」。院外処方では
    # 保険薬局がレジメンを確かめる手掛かりになる。
    def regimen_line(order)
      label = InjectionMeta.regimen_label(order)
      label.present? ? "化学療法: #{label}" : ""
    end

    # 備考の行(レジメン → 処方箋コメント)。
    def remark_lines(order)
      [regimen_line(order), order.dig("note", 0, "text")].compact_blank
    end

    def telecom_value(organization, system)
      Array(organization&.dig("telecom")).find { |t| t["system"] == system }&.dig("value").to_s
    end

    # 保険医療機関コード(10 桁 = 都道府県 2 + 点数表 1 + 医療機関コード 7)を 3 つに分ける。
    # 10 桁でない値はコード欄にそのまま置く。
    def institution_number(organization)
      number = Array(organization&.dig("identifier")).find do |identifier|
        identifier["system"] == PrescriptionReport::INSTITUTION_NO_SYSTEM
      end&.dig("value").to_s
      if number.match?(/\A\d{10}\z/)
        { pref_no: number[0, 2], table_no: number[2, 1], inst_no: number[3, 7] }
      else
        { pref_no: "", table_no: "", inst_no: number }
      end
    end
  end
end
