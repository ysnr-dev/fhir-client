module Reports
  # 輸血関連情報カードを ThinReports レイアウト(lib/report_layouts/transfusion_card.tlf)へ
  # 流し込んで PDF を生成する。A4 縦の list 1 本に「節の見出し → 項目(ラベルと値)→ 補足」を
  # 並べ、ページに入る行数(list の content-height / 明細行の高さ)でここで割り付ける
  # (検査結果の報告書と同じ作り。段は 1 つ)。
  #
  # 明細行(list の detail)の text-block:
  #   category ... 節の見出し(太字)  label / value ... 項目  note ... 補足(字下げした 1 行)
  class TransfusionCardRenderer
    VALUE_MAX_COLS = 92
    NOTE_MAX_COLS = 118
    LIST_ID = "rows".freeze

    Row = Struct.new(:kind, :text, :line, keyword_init: true)

    def initialize(layout_path:, patient:, organization:, sections:, printed_at:)
      @layout_path = layout_path
      @patient = patient
      @organization = organization
      @sections = sections
      @printed_at = printed_at
    end

    def render
      text_ids, = ReportText.layout_item_ids(@layout_path)
      pages = flat_rows.each_slice(rows_per_page).to_a
      pages = [[]] if pages.empty?

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      pages.each_with_index do |rows, index|
        report.start_new_page do |page|
          page_values.merge("page_no" => "#{index + 1} / #{pages.size}").each do |id, value|
            page.item(id).value(value) if text_ids.include?(id)
          end
          rows.each do |row|
            page.list(LIST_ID).add_row do |section|
              case row.kind
              when :category then section.item("category").value(row.text)
              when :note then section.item("note").value(row.text)
              else
                section.item("label").value(row.line.label.presence || "-")
                section.item("value").value(row.text)
              end
            end
          end
        end
      end
      report.generate
    end

    private

    def flat_rows
      @sections.flat_map do |section|
        [Row.new(kind: :category, text: section.title)] +
          section.lines.flat_map do |line|
            chunks = ReportText.wrap(line.value.to_s.presence || "-", VALUE_MAX_COLS)
            value_rows = chunks.each_with_index.map do |chunk, i|
              i.zero? ? Row.new(kind: :item, text: chunk, line:) : Row.new(kind: :note, text: chunk)
            end
            note_rows = line.note.present? ? ReportText.wrap(line.note.to_s, NOTE_MAX_COLS).map { |c| Row.new(kind: :note, text: c) } : []
            value_rows + note_rows
          end
      end
    end

    def rows_per_page
      list = JSON.parse(File.read(@layout_path)).fetch("items").find { |item| item["id"] == LIST_ID }
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
        "report_line" => "血液型・不規則抗体・移植後の型・輸血歴・副作用歴（印刷時点）"
      }
    end
  end
end
