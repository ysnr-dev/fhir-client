module MasterImport
  # JJ1017 の別表(部品コード表)を master_rad_jj1017_codes へ取り込む。
  #
  # 別表はファイルが要素ごとに分かれておらず、1ファイルに複数シート(手技の
  # 大分類/小分類/拡張 など)が入っている。そのため「ファイル内に含まれていた
  # 要素だけ」を洗い替える。JJ1017 のコード表を持たない種別(モダリティ)・左右等は
  # db/seeds.rb から投入するので、ここで消してしまわないための作りでもある。
  #
  # 施設独自の拡張コード(source=local)は洗い替えの対象外で、取込後も残る。
  #
  # シートの構造:
  # - 別表A/D/E は共通で、3〜4行目に「整理番号 / コード意味 / コード値 / Ver / 備考」
  #   のヘッダーがあり、その次の行からコードが並ぶ。列位置はシートによって違うので
  #   ヘッダーの文言から特定する。
  # - 別表B(部位)だけ2段ヘッダーの独自構造で、大部位・臓器系部位・モダリティ別の
  #   使用可否を持つ。同じファイルの「C部位」シートは同じ内容の簡易版なので読まない。
  class RadJj1017CodeImporter
    # シート名 → 要素名。別表B と同内容の「C部位」シートは意図的に対象外。
    SHEET_ELEMENTS = {
      /\A別表A1/ => "procedure_major",
      /\A別表A2/ => "procedure_minor",
      /\A別表A3/ => "procedure_extension",
      /\A別表B/ => "body_part",
      /\A別表D1/ => "body_position",
      /\A別表D2/ => "direction",
      /\A別表E1/ => "detail_position",
      /\A別表E2/ => "special_instruction",
      /\A別表E3/ => "nuclide"
    }.freeze

    # 別表A/D/E 共通ヘッダーの文言 → 取り込み先。
    COLUMN_LABELS = {
      "コード値" => :code,
      "コード意味" => :name,
      "コード意味(英語)" => :name_english,
      "Ver" => :jj_version,
      "備考" => :note,
      "整理番号" => :display_order
    }.freeze
    # 前方一致で見るもの。「補語」は別表A1 だけにある列で、コード意味の後半
    # (健診・人間ドック + 関連の手技)にあたるため名称に連結する。
    COLUMN_PREFIXES = { "補語" => :supplement, "通称名称" => :common_name }.freeze

    BODY_PART_LABELS = {
      "大部位" => :major_part_code,
      "臓器系" => :organ_system_code,
      "小部位" => :code,
      "一般撮影系" => :use_general,
      "CT" => :use_ct,
      "MR" => :use_mr,
      "US" => :use_us
    }.freeze

    Result = Struct.new(:imported_count, :skipped_count, :element_counts, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
      @skipped_count = 0
    end

    def call
      rows = parse_rows
      elements = rows.map { |row| row[:element] }.uniq
      raise ImportError, "JJ1017 の別表シートが見つかりません" if rows.empty?

      reject_local_conflicts(rows)

      ActiveRecord::Base.transaction do
        Master::RadJj1017Code.official.where(element: elements).delete_all
        rows.each_slice(1000) { |slice| Master::RadJj1017Code.insert_all!(slice) }
      end

      Result.new(
        imported_count: rows.size,
        skipped_count: @skipped_count,
        element_counts: rows.group_by { |row| row[:element] }.transform_values(&:size)
      )
    end

    private

    attr_reader :file

    def parse_rows
      ExcelSource.open(file) do |workbook|
        now = Time.current
        workbook.sheets.flat_map do |sheet_name|
          element = element_for(sheet_name)
          next [] if element.nil?

          sheet = workbook.sheet(sheet_name)
          parsed = element == "body_part" ? parse_body_part(sheet) : parse_generic(sheet)
          parsed.map { |attrs| build_row(attrs, element, now) }.compact
        end
      end
    end

    def element_for(sheet_name)
      normalized = ExcelSource.normalize_label(sheet_name)
      SHEET_ELEMENTS.find { |pattern, _| pattern.match?(normalized) }&.last
    end

    # 別表A/D/E。ヘッダー行の文言から列位置を特定してから読む。
    def parse_generic(sheet)
      header_row = ExcelSource.find_header_row(sheet, ["整理番号"])
      raise ImportError, "「整理番号」の見出し行が見つかりません" if header_row.nil?

      columns = generic_columns(sheet, header_row)
      raise ImportError, "「コード値」の列が見つかりません" if columns[:code].nil?

      ((header_row + 1)..sheet.last_row.to_i).map do |row|
        attrs = columns.transform_values { |column| ExcelSource.cell_string(sheet, row, column) }
        attrs[:name] = [attrs[:name], attrs.delete(:supplement)].compact.join
        attrs
      end
    end

    def generic_columns(sheet, header_row)
      (1..sheet.last_column.to_i).each_with_object({}) do |column, map|
        label = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, header_row, column))
        next if label.blank?

        key = COLUMN_LABELS[label] || COLUMN_PREFIXES.find { |prefix, _| label.start_with?(prefix) }&.last
        # 同じ文言の列が複数あるときは左側を採用する。
        map[key] ||= column if key
      end
    end

    # 別表B(部位)。1段目に部位名称・英語名、2段目に大部位/臓器系/小部位と
    # モダリティ別の使用可否が並ぶ2段ヘッダー。
    def parse_body_part(sheet)
      name_row = ExcelSource.find_header_row(sheet, ["部位名称"])
      code_row = ExcelSource.find_header_row(sheet, ["小部位コード", "小部位"])
      raise ImportError, "別表Bの見出し行が見つかりません" if name_row.nil? || code_row.nil?

      columns = body_part_columns(sheet, name_row, code_row)
      raise ImportError, "別表Bの「小部位コード」列が見つかりません" if columns[:code].nil?

      ((code_row + 1)..sheet.last_row.to_i).map do |row|
        attrs = columns.transform_values { |column| ExcelSource.cell_string(sheet, row, column) }
        # モダリティ別使用可否は「1」印の有無。
        BODY_PART_LABELS.each_value do |key|
          attrs[key] = attrs[key].present? if key.to_s.start_with?("use_")
        end
        attrs
      end
    end

    def body_part_columns(sheet, name_row, code_row)
      columns = {}
      (1..sheet.last_column.to_i).each do |column|
        label = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, name_row, column))
        columns[:name] ||= column if label == "部位名称"
        columns[:name_english] ||= column if label.start_with?("BodyPart")
        columns[:display_order] ||= column if label == "番号"
      end
      (1..sheet.last_column.to_i).each do |column|
        label = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, code_row, column))
        next if label.blank?

        key = BODY_PART_LABELS.find { |prefix, _| label.start_with?(prefix) }&.last
        columns[key] ||= column if key
      end
      columns
    end

    def build_row(attrs, element, now)
      code = normalize_code(attrs[:code], element)
      name = attrs[:name]
      # コード値・名称のどちらかが空の行(別表の空行・結合セルの続き)は数えずに捨てる。
      return nil if code.blank? && name.blank?

      if code.blank? || name.blank? || !Master::Jj1017Code.valid_code_format?(element, code)
        @skipped_count += 1
        return nil
      end

      {
        element: element,
        code: code,
        name: name,
        name_english: attrs[:name_english],
        common_name: attrs[:common_name],
        jj_version: attrs[:jj_version],
        note: attrs[:note],
        source: Master::RadJj1017Code::OFFICIAL,
        display_order: attrs[:display_order]&.to_i,
        major_part_code: attrs[:major_part_code],
        organ_system_code: attrs[:organ_system_code],
        use_general: attrs.fetch(:use_general, false),
        use_ct: attrs.fetch(:use_ct, false),
        use_mr: attrs.fetch(:use_mr, false),
        use_us: attrs.fetch(:use_us, false),
        # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
        search_name: Master::SearchNormalizer.normalize(
          [name, attrs[:common_name], attrs[:name_english]].compact.join
        ),
        created_at: now,
        updated_at: now
      }
    end

    # Excel が数値として持っている桁落ち("02" → 2)を戻す。
    def normalize_code(code, element)
      return code if code.blank? || !code.match?(/\A\d+\z/)

      code.rjust(Master::Jj1017Code.length_of(element), "0")
    end

    # 施設拡張コードと同じコード値が配布ファイルに載った場合、洗い替えの対象外の
    # local 行と一意制約でぶつかる。どのコードが問題かを示して取込前に止める。
    def reject_local_conflicts(rows)
      by_element = rows.group_by { |row| row[:element] }
      conflicts = by_element.flat_map do |element, element_rows|
        Master::RadJj1017Code
          .local
          .where(element: element, code: element_rows.map { |row| row[:code] })
          .pluck(:element, :code)
      end
      return if conflicts.empty?

      list = conflicts.map { |element, code| "#{element}:#{code}" }.join(", ")
      raise ImportError, "施設拡張コードと重複するコードが配布ファイルに含まれています(#{list})。" \
                         "拡張コードを削除・変更してから取り込んでください"
    end
  end
end
