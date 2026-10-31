module Reports
  # 外部公開用のレジメン(レジメンマスタ 1 件)を lib/report_layouts/regimen_public.tlf へ流し込む
  # (docs/report-mappings/regimen-01.md)。上段にレジメンの属性、中段の list に
  # 「適応疾患 → 投与内容 → 投与基準 → 減量基準 → 中止基準 → 主な副作用 → 参考文献」を見出しごとに並べる。
  #
  # 患者情報・承認者・内部の備考(note)は載せない。list の自動改ページは使わず、行数で割り付ける
  # (実施計画書と同じ)。見出しをページの最終行に残さず、ページの頭が薬剤の途中ならステップ見出しを補う。
  class RegimenPublicRenderer
    LIST_ID = "content".freeze
    # 桁数(半角換算)。それぞれの欄の幅と文字の大きさ(IPAGothic)で入る量。
    STEP_MAX_COLS = 112
    BODY_MAX_COLS = 116
    NOTE_MAX_COLS = 120

    SETTING_LABELS = { "outpatient" => "外来", "inpatient" => "入院", "both" => "外来・入院" }.freeze
    USAGE_TYPE_LABELS = { "drip" => "点滴", "one-shot" => "ワンショット", "oral" => "内服" }.freeze
    LAB_CATEGORY_LABELS = { "renal" => "腎機能", "hepatic" => "肝機能", "blood" => "血液検査",
                            "other" => "その他" }.freeze
    # frontend の injectionHelpers.ts の ROUTE_OPTIONS / LINE_OPTIONS と同じ定義。
    ROUTE_LABELS = { "IV" => "静脈内", "IM" => "筋肉内", "SC" => "皮下", "ID" => "皮内", "IA" => "動脈内",
                     "IT" => "髄腔内", "IP" => "腹腔内" }.freeze
    LINE_LABELS = { "peripheral" => "末梢ルート", "peripheral-side" => "末梢ルート(側管)",
                    "central" => "中心静脈ルート", "central-side" => "中心静脈ルート(側管)" }.freeze

    Row = Struct.new(:kind, :text, :drug, keyword_init: true)

    def initialize(layout_path:, regimen:, steps:, drugs_by_step:, usages:, organization:, printed_on:)
      @layout_path = layout_path
      @regimen = regimen
      @steps = steps
      @drugs_by_step = drugs_by_step
      @usages = usages
      @organization = organization || {}
      @printed_on = printed_on
    end

    def render
      text_ids, = ReportText.layout_item_ids(@layout_path)
      pages = paginate(rows)
      pages = [[]] if pages.empty?

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      pages.each_with_index do |page_rows, index|
        report.start_new_page do |page|
          page_values.merge("page_no" => "#{index + 1} / #{pages.size}").each do |id, value|
            page.item(id).value(value) if text_ids.include?(id)
          end
          fill(page.list(LIST_ID), page_rows)
        end
      end
      report.generate
    end

    private

    def fill(list, page_rows)
      page_rows.each do |row|
        list.add_row do |section|
          case row.kind
          when :blank then nil
          when :drug
            section.item("role").value(row.drug[:role])
            section.item("name").value(row.drug[:name])
            section.item("basis").value(row.drug[:basis])
            section.item("max").value(row.drug[:max])
          else section.item(row.kind.to_s).value(row.text)
          end
        end
      end
    end

    def paginate(all_rows)
      capacity = rows_per_page
      pages = []
      current = []
      step = nil
      all_rows.each do |row|
        heading_at_bottom = row.kind == :section && current.size >= capacity - 1
        if current.any? && (current.size >= capacity || heading_at_bottom)
          pages << current
          current = []
        end
        next if current.empty? && row.kind == :blank

        current << Row.new(kind: :step, text: "#{step}（続き）") if current.empty? && %i[drug note].include?(row.kind) && step
        current << row
        step = row.text if row.kind == :step
        step = nil if row.kind == :section
      end
      pages << current if current.any?
      pages
    end

    def rows_per_page
      list = JSON.parse(File.read(@layout_path)).fetch("items").find { |item| item["id"] == LIST_ID }
      (list["content-height"] / list.dig("detail", "height")).floor
    end

    def rows
      [
        section("適応疾患", indication_rows),
        section("投与内容", step_rows),
        section("投与基準（検査値）", lab_rows),
        section("減量基準", body_rows(@regimen.dose_reduction_criteria)),
        section("中止基準", body_rows(@regimen.discontinuation_criteria)),
        section("主な副作用", adverse_event_rows),
        section("参考文献", body_rows(@regimen.references_note))
      ].compact.flat_map.with_index { |rows, index| index.zero? ? rows : [Row.new(kind: :blank), *rows] }
    end

    # 中身の無い見出しは出さない。
    def section(title, body)
      return nil if body.empty?

      [Row.new(kind: :section, text: "■ #{title}"), *body]
    end

    def indication_rows
      names = @regimen.indications.map { |i| [i.name, i.icd10.present? ? "（#{i.icd10}）" : nil].join }
      body_rows([names.join("、"), @regimen.indication_note].compact_blank.join("\n"))
    end

    def step_rows
      return [] if @steps.empty?

      header = Row.new(kind: :drug, drug: { role: "種類", name: "医薬品", basis: "投与量", max: "上限" })
      [header] + @steps.each_with_index.flat_map do |step, index|
        drugs = @drugs_by_step[step.id] || []
        [
          *ReportText.wrap(step_heading(step, index + 1), STEP_MAX_COLS).map { |t| Row.new(kind: :step, text: t) },
          *drugs.flat_map { |drug| [Row.new(kind: :drug, drug: drug_values(drug)), *note_rows(drug.note)] },
          *note_rows([step.device_note.present? ? "器材: #{step.device_note}" : nil, step.note].compact_blank.join(" / "))
        ]
      end
    end

    # 「1. オキサリプラチン　Day 1　点滴　静脈内　末梢ルート　2時間」
    # 「2. カペシタビン　Day 1 から 14 日分　内服　１日２回朝夕食後」
    def step_heading(step, number)
      usage_type = USAGE_TYPE_LABELS.fetch(step.usage_type, step.usage_type)
      parts = [
        "#{number}. #{step.name.presence || usage_type}", days_label(step), usage_type,
        *(step.usage_type == "oral" ? [@usages[step.usage_code]&.usage_name] : injection_parts(step))
      ]
      parts.compact_blank.join("　")
    end

    def days_label(step)
      days = Array(step.days).select { |d| d.is_a?(Integer) }.sort
      return "" if days.empty?

      label = "Day #{days.join(', ')}"
      return label unless step.usage_type == "oral" && step.dose_days.to_i.positive?

      "#{label} から#{days.size > 1 ? '各' : ''} #{step.dose_days} 日分"
    end

    def injection_parts(step)
      [
        ROUTE_LABELS[step.route_code],
        LINE_LABELS[step.line_code],
        duration_label(step.infusion_minutes),
        step.rate ? "#{RegimenNumber.format(step.rate)} mL/h" : nil
      ]
    end

    # 「30分」「2時間」「1時間30分」
    def duration_label(minutes)
      return nil unless minutes.to_i.positive?

      hours, rest = minutes.divmod(60)
      [hours.positive? ? "#{hours}時間" : nil, rest.positive? ? "#{rest}分" : nil].compact.join
    end

    def drug_values(drug)
      {
        role: RegimenReport::DrugLookup::ROLE_LABELS[drug.drug_role].to_s,
        name: drug.resolved_name.presence || drug.medicine_code,
        basis: RegimenReport::DrugLookup.basis_label(drug),
        max: drug.dose_max ? "#{RegimenNumber.format(drug.dose_max)} #{drug.dose_unit}".strip : ""
      }
    end

    # 「好中球数（血液検査）　≧ 1500 /μL」
    def lab_rows
      @regimen.lab_criteria.flat_map do |criterion|
        label = "#{criterion.item_name}（#{LAB_CATEGORY_LABELS.fetch(criterion.category, criterion.category)}）"
        body_rows([label, range_label(criterion), criterion.note].compact_blank.join("　"))
      end
    end

    # frontend の criterionRangeLabel と同じ書き方。
    def range_label(criterion)
      lower = RegimenNumber.format(criterion.lower_limit)
      upper = RegimenNumber.format(criterion.upper_limit)
      suffix = criterion.unit.present? ? " #{criterion.unit}" : ""
      return "#{lower}〜#{upper}#{suffix}" if lower.present? && upper.present?
      return "≧ #{lower}#{suffix}" if lower.present?
      return "≦ #{upper}#{suffix}" if upper.present?

      ""
    end

    def adverse_event_rows
      @regimen.adverse_events.flat_map do |event|
        grade = event.grade ? "（Grade #{event.grade}）" : ""
        body_rows(["#{event.term}#{grade}", event.note].compact_blank.join("　"))
      end
    end

    def body_rows(text)
      text.to_s.split(/\r?\n/).map(&:rstrip).compact_blank.flat_map do |line|
        ReportText.wrap(line, BODY_MAX_COLS).map { |chunk| Row.new(kind: :body, text: chunk) }
      end
    end

    def note_rows(text)
      return [] if text.blank?

      ReportText.wrap(text, NOTE_MAX_COLS).map { |chunk| Row.new(kind: :note, text: chunk) }
    end

    def page_values
      phone = Array(@organization["telecom"]).find { |t| t["system"] == "phone" }&.dig("value")
      {
        "hospital_name" => @organization["name"].to_s,
        "printed_on" => "発行 #{@printed_on.strftime('%Y/%m/%d')}",
        "regimen_title" => @regimen.name.to_s,
        "regimen_code" => @regimen.regimen_code.to_s,
        "department" => @regimen.department_name.to_s,
        "purpose" => RegimenPlanRenderer::PURPOSE_LABELS.fetch(@regimen.purpose.to_s, ""),
        "setting" => SETTING_LABELS.fetch(@regimen.setting.to_s, ""),
        "cycle_rule" => cycle_rule,
        "planned_cycles" => @regimen.planned_cycles ? "#{@regimen.planned_cycles} クール" : "継続",
        "emetic_risk" => RegimenPlanRenderer::EMETIC_LABELS.fetch(@regimen.emetic_risk.to_s, ""),
        "approved_on" => @regimen.approved_on&.strftime("%Y/%m/%d").to_s,
        "contact" => [@organization["name"].to_s, phone.present? ? "TEL #{phone}" : nil].compact_blank.join("　")
      }
    end

    # 「21 日（投与 14 日・休薬 7 日）」
    def cycle_rule
      days = @regimen.cycle_days
      return "" unless days.positive?

      "#{days} 日（投与 #{@regimen.treatment_days.to_i} 日・休薬 #{@regimen.rest_days.to_i} 日）"
    end
  end
end
