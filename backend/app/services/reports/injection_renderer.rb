module Reports
  # 注射箋(注射指示票)を ThinReports レイアウトへ流し込んで PDF を生成する
  # (docs/report-mappings/injection-01.md)。処方箋(PrescriptionRenderer)と同じく、
  # 注射内容は 1 個の text-block(rx_content)に整形済みの行を流し込み、枠を超えたら
  # 同じレイアウトで続紙を起こす。
  #
  # 注射箋と注射指示票を 1 様式にしているのは、どちらも「その日のこの患者の注射」の
  # 一覧で中身が同じだから。薬剤部は払出の指示書として、病棟は下段の実施記録欄
  # (時刻・実施者の手書き)を使って指示票として読む。
  class InjectionRenderer
    def initialize(layout_path:, order:, patient:, organization:, rps:, lines_per_page:, max_cols:)
      @layout_path = layout_path
      @order = order
      @patient = patient
      @organization = organization
      @rps = rps
      @lines_per_page = lines_per_page
      @max_cols = max_cols
    end

    def render
      text_ids, _image_ids, all_ids = ReportText.layout_item_ids(@layout_path)
      pages = rp_lines.flat_map { |line| ReportText.wrap(line, @max_cols) }
                      .each_slice(@lines_per_page).to_a
      pages = [[]] if pages.empty?

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      pages.each_with_index do |lines, index|
        report.start_new_page do |page|
          values = page_values.merge(
            "rx_content" => lines.join("\n"),
            "page_no" => "#{index + 1} / #{pages.size}"
          )
          values.each { |id, value| page.item(id).value(value) if text_ids.include?(id) }
          if all_ids.include?("continued")
            index < pages.size - 1 ? page.item("continued").show : page.item("continued").hide
          end
        end
      end
      report.generate
    end

    private

    # RP 1 件を「RP 見出し(用法) → 薬剤 → 開始時刻・用法コメント」の行にする。
    # カルテの注射カードと同じ読み順。
    def rp_lines
      @rps.flat_map do |rp|
        usage = InjectionMeta.usage_summary(rp)
        lines = ["RP#{rp.rp_number}#{usage.present? ? "　#{usage}" : ''}"]
        rp.medicines.each do |medicine|
          dose = medicine.dose.present? ? " #{medicine.dose}#{medicine.unit}" : ""
          comment = medicine.comment.present? ? "（#{medicine.comment}）" : ""
          lines << "　#{medicine.name}#{dose}#{comment}"
        end
        tail = []
        tail << "開始: #{rp.start_times.join('、')}" if rp.start_times.any?
        tail << "（#{rp.usage_comment}）" if rp.usage_comment.present?
        lines << "　#{tail.join('　')}" if tail.any?
        lines
      end
    end

    def page_values
      {
        "pt_id" => PatientMeta.identifier(@patient),
        "pt_name" => PatientMeta.display_name(@patient),
        "pt_kana" => PatientMeta.display_kana(@patient),
        "pt_gender" => PatientMeta.gender_label(@patient),
        "pt_birthdate" => PatientMeta.format_date(@patient["birthDate"]),
        # 注射日(authoredOn)。発行操作の日ではないので、再発行しても同じ日付になる。
        "issue_date" => PatientMeta.format_date(@order["authoredOn"].to_s.first(10)),
        "doctor_line" => [InjectionMeta.department_name(@order),
                          @order.dig("requester", "display").to_s].compact_blank.join(" | "),
        "ward_name" => InjectionMeta.ward_name(@order),
        "rx_category" => InjectionMeta.category_display(@order),
        "series_label" => InjectionMeta.series_label(@order),
        "remarks" => @order.dig("note", 0, "text").to_s,
        "hospital_name" => (@organization || {})["name"].to_s
      }
    end
  end
end
