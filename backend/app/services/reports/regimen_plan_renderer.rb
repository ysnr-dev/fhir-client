module Reports
  # 化学療法実施計画書(1 クールぶん)を lib/report_layouts/regimen_plan.tlf へ流し込む
  # (docs/report-mappings/regimen-01.md)。上段に患者とレジメン、中段の list にそのクールの
  # 投与表を「日 → RP(ステップ)→ 薬剤 → 注記」の順で並べ、下段は備考と署名欄。
  #
  # list の自動改ページは使わず、行数(content-height / 明細行の高さ)でここで割り付ける
  # (検査結果報告書と同じ)。ページの頭が日の途中なら「(続き)」の日見出しを補う。
  class RegimenPlanRenderer
    LIST_ID = "content".freeze
    # 注記(note)の桁数(半角換算)。7.5pt の IPAGothic で note 欄の幅(459pt)に入る量。
    NOTE_MAX_COLS = 120
    STEP_MAX_COLS = 118

    PURPOSE_LABELS = { "neoadjuvant" => "術前補助", "adjuvant" => "術後補助", "curative" => "根治",
                       "palliative" => "緩和", "other" => "その他" }.freeze
    EMETIC_LABELS = { "high" => "高度", "moderate" => "中等度", "low" => "軽度", "minimal" => "最小度" }.freeze
    APPLICATION_STATUS_LABELS = { "active" => "適用中", "completed" => "完了", "revoked" => "中止",
                                  "on-hold" => "休止" }.freeze
    DAY_STATUS_LABELS = { "requested" => "依頼済", "accepted" => "受付済", "on-hold" => "照会中",
                          "in-progress" => "払出済", "completed" => "実施済", "cancelled" => "中止" }.freeze
    WEEKDAYS = %w[日 月 火 水 木 金 土].freeze

    Row = Struct.new(:kind, :text, :drug, keyword_init: true)

    def initialize(layout_path:, application:, patient:, organization:, master:, cycle:, orders:, cycle_start:,
                   printed_on:)
      @layout_path = layout_path
      @application = application
      @patient = patient
      @organization = organization
      @master = master
      @cycle = cycle
      @orders = orders
      @cycle_start = cycle_start
      @printed_on = printed_on
    end

    def render
      text_ids, _image_ids, all_ids = ReportText.layout_item_ids(@layout_path)
      pages = paginate(rows)
      pages = [[]] if pages.empty?

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      pages.each_with_index do |page_rows, index|
        report.start_new_page do |page|
          page_values.merge("page_no" => "#{index + 1} / #{pages.size}").each do |id, value|
            page.item(id).value(value) if text_ids.include?(id)
          end
          fill(page.list(LIST_ID), page_rows)
          if all_ids.include?("continued")
            index < pages.size - 1 ? page.item("continued").show : page.item("continued").hide
          end
        end
      end
      report.generate
    end

    private

    def fill(list, page_rows)
      page_rows.each do |row|
        list.add_row do |section|
          case row.kind
          when :day then section.item("day").value(row.text)
          when :step then section.item("step").value(row.text)
          when :note then section.item("note").value(row.text)
          else
            drug = row.drug
            section.item("role").value(drug.role)
            section.item("name").value(drug.name)
            section.item("basis").value(drug.basis)
            section.item("ratio").value(ratio_text(drug.ratio))
            section.item("dose").value(drug.dose.nil? ? "" : "#{RegimenNumber.format(drug.dose)} #{drug.unit}".strip)
            section.item("packs").value(drug.packs.nil? ? "" : "#{RegimenNumber.format(drug.packs)} #{drug.pack_unit}".strip)
          end
        end
      end
    end

    def ratio_text(ratio)
      return "" if ratio.nil?

      "#{RegimenNumber.format(ratio)}%"
    end

    def paginate(all_rows)
      capacity = rows_per_page
      pages = []
      current = []
      day = nil
      all_rows.each do |row|
        full = current.size >= capacity || (row.kind == :day && current.size >= capacity - 1)
        if current.any? && full
          pages << current
          current = []
        end
        current << Row.new(kind: :day, text: "#{day}（続き）") if current.empty? && row.kind != :day && day
        current << row
        day = row.text if row.kind == :day
      end
      pages << current if current.any?
      pages
    end

    def rows_per_page
      list = JSON.parse(File.read(@layout_path)).fetch("items").find { |item| item["id"] == LIST_ID }
      (list["content-height"] / list.dig("detail", "height")).floor
    end

    def rows
      @orders.flat_map do |order|
        result = [Row.new(kind: :day, text: day_heading(order))]
        if order.reduction.present?
          result.concat(note_rows("減量: #{order.reduction}"))
        end
        order.steps.each do |step|
          result.concat(ReportText.wrap(step_heading(step), STEP_MAX_COLS).map { |t| Row.new(kind: :step, text: t) })
          result.concat(step.drugs.map { |drug| Row.new(kind: :drug, drug:) })
          result.concat(note_rows(step.notes.join(" / "))) if step.notes.any?
        end
        result
      end
    end

    def note_rows(text)
      ReportText.wrap(text, NOTE_MAX_COLS).map { |chunk| Row.new(kind: :note, text: chunk) }
    end

    # 「Day1　2026/09/22(火)　注射　［依頼済］」
    def day_heading(order)
      date = Date.parse(order.date)
      kind = order.kind == :injection ? "注射" : "内服"
      status = DAY_STATUS_LABELS.fetch(order.status, order.status)
      "Day#{order.day}　#{date.strftime('%Y/%m/%d')}(#{WEEKDAYS[date.wday]})　#{kind}　［#{status}］"
    end

    # 「RP1 前投薬　点滴 静脈内」「RP1 カペシタビン　１日２回朝夕食後　服用　14日分」
    def step_heading(step)
      supply = step.supply_days.to_i.positive? ? "#{step.supply_days}日分" : nil
      head = ["RP#{step.rp_number}", step.name.presence].compact.join(" ")
      [head, step.usage.presence, supply].compact.join("　")
    end

    def page_values
      {
        "hospital_name" => (@organization || {})["name"].to_s,
        "printed_on" => "発行 #{@printed_on.strftime('%Y/%m/%d')}",
        "cycle_title" => "第 #{@cycle} クール",
        "pt_id" => PatientMeta.identifier(@patient),
        "pt_name" => PatientMeta.display_name(@patient),
        "pt_kana" => PatientMeta.display_kana(@patient),
        "pt_gender" => PatientMeta.gender_label(@patient),
        "pt_birthdate" => PatientMeta.format_date(@patient["birthDate"]),
        "regimen_name" => [@application.name, @application.code.present? ? "（#{@application.code}）" : nil].join,
        "regimen_status" => APPLICATION_STATUS_LABELS.fetch(@application.status, @application.status),
        "purpose" => PURPOSE_LABELS.fetch(@master&.purpose.to_s, ""),
        "setting" => @application.setting,
        "problem" => @application.problem,
        "emetic_risk" => EMETIC_LABELS.fetch(@master&.emetic_risk.to_s, ""),
        "cycle_rule" => cycle_rule,
        "cycle_period" => cycle_period,
        "body_line" => body_line,
        "doctor_line" => [@application.department, @application.requester].compact_blank.join(" | "),
        "remarks" => @application.comment
      }
    end

    # 「21 日/クール(投与 14 日・休薬 7 日) · 予定 8 クール」
    def cycle_rule
      days = @application.cycle_days
      parts = []
      if days.positive?
        rest = days - @application.treatment_days
        detail = @application.treatment_days.positive? ? "（投与 #{@application.treatment_days} 日・休薬 #{rest} 日）" : ""
        parts << "#{days} 日/クール#{detail}"
      end
      parts << (@application.planned_cycles ? "予定 #{@application.planned_cycles} クール" : "継続")
      parts.join(" · ")
    end

    # 「2026/09/22 〜 2026/10/12」(Day 1 〜 クールの最終日)。
    def cycle_period
      return "" unless @cycle_start

      finish = @application.cycle_days.positive? ? @cycle_start + (@application.cycle_days - 1) : nil
      [@cycle_start.strftime("%Y/%m/%d"), finish&.strftime("%Y/%m/%d")].compact.join(" 〜 ")
    end

    # 身長・体重は適用時の値(ヘッダ)。体表面積はこのクールの投与量に使った値(明細の拡張)を優先する。
    def body_line
      bsa = @orders.flat_map(&:steps).flat_map(&:drugs).filter_map(&:bsa).first || @application.bsa
      [
        @application.height ? "身長 #{RegimenNumber.format(@application.height)} cm" : nil,
        @application.weight ? "体重 #{RegimenNumber.format(@application.weight)} kg" : nil,
        bsa ? "体表面積 #{RegimenNumber.format(bsa)} m²" : nil
      ].compact.join(" / ")
    end
  end
end
