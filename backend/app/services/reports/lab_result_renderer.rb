module Reports
  # 検体検査結果の報告書を ThinReports レイアウト(lib/report_layouts/lab_result.tlf)へ
  # 流し込んで PDF を生成する。A4 縦の 1 ページを左右 2 段にし、段ごとに list を 1 本置く。
  #
  # 行は「分野見出し → 項目 → (あれば)項目のコメント」の順に並べ、左段 → 右段 → 次ページの順に
  # 流す。list の自動改ページは使わず、段の行数(list の content-height / 明細行の高さ)で
  # ここで割り付ける。段の頭が分野の途中なら「〜(続き)」の見出しを補い、段の最終行に
  # 見出しだけが残る場合は次の段へ送る。総合所見は最後の分野の後ろに同じ形で続ける。
  #
  # 明細行(list の detail)の text-block:
  #   category ... 分野見出し(太字)  name / value / flag / unit / range ... 項目
  #   note ... 項目のコメント・総合所見の本文(字下げした 1 行)
  class LabResultRenderer
    # note の桁数(半角換算)。8pt の IPAGothic で note 欄の幅(244pt)に入る量。
    NOTE_MAX_COLS = 60
    CONCLUSION_TITLE = "総合所見".freeze
    LISTS = %w[left right].freeze

    Row = Struct.new(:kind, :text, :line, keyword_init: true)

    def initialize(layout_path:, patient:, organization:, summary:, groups:, printed_at:)
      @layout_path = layout_path
      @patient = patient
      @organization = organization
      @summary = summary
      @groups = groups
      @printed_at = printed_at
    end

    def render
      text_ids, = ReportText.layout_item_ids(@layout_path)
      pages = columns.each_slice(LISTS.size).to_a
      pages = [[[]]] if pages.empty?

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      pages.each_with_index do |page_columns, index|
        report.start_new_page do |page|
          page_values.merge("page_no" => "#{index + 1} / #{pages.size}").each do |id, value|
            page.item(id).value(value) if text_ids.include?(id)
          end
          LISTS.each_with_index do |list_id, column_index|
            rows = page_columns[column_index]
            rows ? fill(page.list(list_id), rows) : page.list(list_id).hide
          end
        end
      end
      report.generate
    end

    private

    def fill(list, rows)
      rows.each do |row|
        list.add_row do |section|
          case row.kind
          when :category
            section.item("category").value(row.text)
          when :note
            section.item("note").value(row.text)
          else
            line = row.line
            section.item("name").value(line.name.presence || "-")
            section.item("value").value(line.value.presence || "-")
            section.item("value").style(:bold, true) if line.flag.present?
            section.item("flag").value(line.flag)
            section.item("unit").value(line.unit)
            section.item("range").value(line.range)
          end
        end
      end
    end

    # 段ごとの行の配列。左段を下まで埋めてから右段へ移る。
    def columns
      flow(flat_rows, rows_per_column, nil)
    end

    # rows を高さ capacity の段に流し込む。category は流し始めの時点の分野(段の頭が
    # 分野の途中なら「続き」の見出しを補うため)。
    def flow(rows, capacity, category)
      result = []
      current = []
      rows.each do |row|
        full = current.size >= capacity || (row.kind == :category && current.size >= capacity - 1)
        if current.any? && full
          result << current
          current = []
        end
        if current.empty? && row.kind != :category && category
          current << Row.new(kind: :category, text: "#{category}（続き）")
        end
        current << row
        category = row.text if row.kind == :category
      end
      result << current if current.any?
      result
    end

    def flat_rows
      rows = @groups.flat_map do |group|
        [Row.new(kind: :category, text: group.category)] +
          group.lines.flat_map do |line|
            [Row.new(kind: :item, line:)] + note_rows(line.note)
          end
      end
      if @summary.conclusion.present?
        rows << Row.new(kind: :category, text: CONCLUSION_TITLE)
        rows.concat(@summary.conclusion.split(/\r?\n/).flat_map { |paragraph| note_rows(paragraph, blank: true) })
      end
      rows
    end

    def note_rows(text, blank: false)
      return [] if text.blank? && !blank

      ReportText.wrap(text.to_s, NOTE_MAX_COLS).map { |chunk| Row.new(kind: :note, text: chunk) }
    end

    # 段の行数。レイアウトの list の寸法から決める(左右の list は同じ寸法)。
    def rows_per_column
      list = JSON.parse(File.read(@layout_path)).fetch("items").find { |item| item["id"] == LISTS.first }
      (list["content-height"] / list.dig("detail", "height")).floor
    end

    def page_values
      {
        "hospital_name" => (@organization || {})["name"].to_s,
        "patient_line" => [
          "患者番号 #{PatientMeta.identifier(@patient)}",
          PatientMeta.display_name(@patient),
          @patient["birthDate"].present? ? "#{PatientMeta.format_date(@patient['birthDate'])} 生" : nil,
          PatientMeta.gender_label(@patient)
        ].compact_blank.join("　"),
        "printed_at" => "印刷 #{@printed_at.strftime('%Y/%m/%d %H:%M')}",
        "report_line" => [
          "検体採取日 #{@summary.date.presence || '-'}",
          @summary.setting, @summary.department, @summary.status,
          @summary.issued.present? ? "報告 #{@summary.issued}" : nil
        ].compact_blank.join("　")
      }
    end
  end
end
