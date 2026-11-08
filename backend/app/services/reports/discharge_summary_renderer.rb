module Reports
  # 退院時サマリーを ThinReports レイアウト(lib/report_layouts/discharge_summary.tlf)へ流し込んで
  # PDF を生成する。A4 縦の全幅に list を 1 本置き、行は「セクション見出し → 本文の行」の順に並べる。
  #
  # 長文はここで桁数で折り返し(ReportText.wrap)、list の自動改ページは使わずにページの行数
  # (list の content-height / 明細行の高さ)で割り付ける。ページの頭がセクションの途中なら
  # 「〜(続き)」の見出しを補い、ページの最終行に見出しだけが残る場合は次のページへ送る。
  # セクションの間は 1 行あける(ページの頭に来る空行は落とす)。
  #
  # 明細行(list の detail)の text-block:
  #   heading ... セクション見出し(太字)  text ... 本文の 1 行(字下げ)
  class DischargeSummaryRenderer
    # text の桁数(半角換算)。10pt の IPAGothic で text 欄の幅(517pt)に入る量。
    TEXT_MAX_COLS = 100
    LIST_ID = "body".freeze

    Row = Struct.new(:kind, :text, keyword_init: true)

    def initialize(layout_path:, patient:, organization:, admission:, record:, sections:, printed_at:)
      @layout_path = layout_path
      @patient = patient
      @organization = organization
      @admission = admission
      @record = record
      @sections = sections
      @printed_at = printed_at
    end

    def render
      text_ids, = ReportText.layout_item_ids(@layout_path)
      pages = paginate(flat_rows, rows_per_page)
      pages = [[]] if pages.empty?

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      pages.each_with_index do |rows, index|
        report.start_new_page do |page|
          page_values.merge("page_no" => "#{index + 1} / #{pages.size}").each do |id, value|
            page.item(id).value(value) if text_ids.include?(id)
          end
          fill(page.list(LIST_ID), rows)
        end
      end
      report.generate
    end

    private

    def fill(list, rows)
      rows.each do |row|
        list.add_row do |section|
          section.item(row.kind == :heading ? "heading" : "text").value(row.text)
        end
      end
    end

    def flat_rows
      @sections.each_with_index.flat_map do |section, index|
        rows = index.zero? ? [] : [Row.new(kind: :blank, text: "")]
        rows << Row.new(kind: :heading, text: section.title)
        rows + section.paragraphs.flat_map do |paragraph|
          next [Row.new(kind: :blank, text: "")] if paragraph.empty?

          ReportText.wrap(paragraph, TEXT_MAX_COLS, indent: false).map { |chunk| Row.new(kind: :text, text: chunk) }
        end
      end
    end

    # rows を高さ capacity のページに流し込む。heading は流し始めの時点のセクション名
    # (ページの頭がセクションの途中なら「続き」の見出しを補うため)。
    def paginate(rows, capacity)
      result = []
      current = []
      heading = nil
      rows.each do |row|
        full = current.size >= capacity || (row.kind == :heading && current.size >= capacity - 1)
        if current.any? && full
          result << current
          current = []
        end
        next if current.empty? && row.kind == :blank

        if current.empty? && row.kind == :text && heading
          current << Row.new(kind: :heading, text: "#{heading}（続き）")
        end
        current << row
        heading = row.text if row.kind == :heading
      end
      result << current if current.any?
      result
    end

    # ページの行数。レイアウトの list の寸法から決める。
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
        "admission_line" => admission_line,
        "record_line" => record_line
      }
    end

    def admission_line
      admission = @admission
      return "" if admission.admitted.blank?

      period = "入院 #{admission.admitted} 〜 #{admission.discharged.presence || '入院中'}"
      period += "（#{admission.stay_days} 日）" if admission.stay_days
      [
        period,
        admission.department,
        admission.attending.present? ? "主治医 #{admission.attending}" : nil,
        admission.disposition.present? ? "転帰 #{admission.disposition}" : nil
      ].compact_blank.join("　")
    end

    def record_line
      record = @record
      [
        record.recorded_at.present? ? "記録 #{record.recorded_at}" : nil,
        record.status,
        record.department,
        record.author.present? ? "作成 #{record.author}" : nil,
        record.attester.present? ? "確定 #{[record.attester, record.attested_at].compact_blank.join(' ')}" : nil
      ].compact_blank.join("　")
    end
  end
end
