module MasterImport
  # JANIS 検査部門の材料(検査材料)コード表(specimenentitytype_ver*.xls)を
  # master_micro_specimen_types へ取り込む。
  #
  # シートは「系統 / コード番号 / 検査材料名」のヘッダー行の下にコードが並ぶ。
  # 系統は結合セル風に先頭行にだけ入っているので、空欄の行は直前の値を引き継ぐ。
  #
  # source=official のみ全件洗い替えし、施設追加分(source=local)は温存する。
  class MicroSpecimenTypeImporter
    Result = Struct.new(:imported_count, :skipped_count, keyword_init: true)

    include OfficialLocalReplace

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
      @skipped_count = 0
    end

    def call
      rows = parse_rows
      replace_official!(Master::MicroSpecimenType, rows)

      Result.new(imported_count: rows.size, skipped_count: @skipped_count)
    end

    private

    attr_reader :file

    def parse_rows
      ExcelSource.open(file) do |workbook|
        sheet, header_row = find_sheet(workbook)
        raise ImportError, "「検査材料名」の見出し行が見つかりません" if sheet.nil?

        columns = header_columns(sheet, header_row)
        raise ImportError, "「コード番号」の列が見つかりません" if columns[:code].nil?

        build_rows(sheet, header_row, columns)
      end
    end

    def find_sheet(workbook)
      workbook.sheets.each do |sheet_name|
        sheet = workbook.sheet(sheet_name)
        header_row = ExcelSource.find_header_row(sheet, ["検査材料名"])
        return [sheet, header_row] if header_row
      end
      nil
    end

    def header_columns(sheet, header_row)
      (1..sheet.last_column.to_i).each_with_object({}) do |column, map|
        label = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, header_row, column))
        next if label.blank?

        map[:category] ||= column if label == "系統"
        # 配布ファイルの見出しは「コ－ド番号」(長音記号)。NFKC 正規化後の
        # 揺れも拾えるよう、間の1文字は何でもよいことにする。
        map[:code] ||= column if /\Aコ.?ド番号\z/.match?(label)
        map[:name] ||= column if label == "検査材料名"
      end
    end

    def build_rows(sheet, header_row, columns)
      seen = Set.new
      now = Time.current
      category = nil
      display_order = 0

      ((header_row + 1)..sheet.last_row.to_i).filter_map do |row|
        if columns[:category]
          category_cell = ExcelSource.cell_string(sheet, row, columns[:category])
          category = category_cell if category_cell.present?
        end
        code = ExcelSource.cell_string(sheet, row, columns[:code])
        name = ExcelSource.cell_string(sheet, row, columns[:name])
        next if code.blank? && name.blank?

        # コードが数字でない・名称なし・重複の行は取り込めないので件数だけ数えて捨てる。
        if !/\A\d+\z/.match?(code.to_s) || name.blank? || !seen.add?(code)
          @skipped_count += 1
          next
        end

        display_order += 10
        {
          code: code,
          name: name,
          category: category,
          source: Master::MicroSpecimenType::OFFICIAL,
          display_order: display_order,
          # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
          search_name: Master::SearchNormalizer.normalize([name, category].compact.join),
          created_at: now,
          updated_at: now
        }
      end
    end
  end
end
