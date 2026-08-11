module MasterImport
  # JANIS 検査部門の薬剤感受性検査測定法コード表
  # (drugsusceptibilitymeasurementmethod_ver*.xls)を
  # master_micro_susceptibility_methods へ取り込む。
  #
  # 配布ファイルは版ごとのシート("Ver.1.0"〜"Ver.4.0")を持つので、版番号が
  # 最も新しいシートだけを読む。ヘッダーは [コード / 方法 / (空欄) / 製品名 /
  # 発売会社 / 備考] で、分類(自動化機器・用手法)の列は見出しセルが空のため
  # 「方法」列の右隣を固定で読む。
  #
  # source=official のみ全件洗い替えし、施設追加分(source=local)は温存する。
  class MicroSusceptibilityMethodImporter
    Result = Struct.new(:imported_count, :skipped_count, :sheet_name, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
      @skipped_count = 0
    end

    def call
      rows = parse_rows
      raise ImportError, "取り込める行がありません" if rows.empty?

      ActiveRecord::Base.transaction do
        reject_local_conflicts(rows)

        Master::MicroSusceptibilityMethod.official.delete_all
        rows.each_slice(1000) { |slice| Master::MicroSusceptibilityMethod.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size, skipped_count: @skipped_count, sheet_name: @sheet_name)
    end

    private

    attr_reader :file

    def parse_rows
      ExcelSource.open(file) do |workbook|
        @sheet_name = ExcelSource.latest_version_sheet(workbook)
        sheet = workbook.sheet(@sheet_name)

        header_row = ExcelSource.find_header_row(sheet, ["方法"])
        raise ImportError, "「方法」の見出し行が見つかりません" if header_row.nil?

        columns = header_columns(sheet, header_row)
        raise ImportError, "「コード」の列が見つかりません" if columns[:code].nil?

        build_rows(sheet, header_row, columns)
      end
    end

    def header_columns(sheet, header_row)
      (1..sheet.last_column.to_i).each_with_object({}) do |column, map|
        label = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, header_row, column))
        next if label.blank?

        map[:code] ||= column if label == "コード"
        map[:name] ||= column if label == "方法"
        map[:product_name] ||= column if label == "製品名"
        map[:company] ||= column if label == "発売会社"
        map[:note] ||= column if label == "備考"
      end
    end

    def build_rows(sheet, header_row, columns)
      seen = Set.new
      now = Time.current
      display_order = 0

      ((header_row + 1)..sheet.last_row.to_i).filter_map do |row|
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
          # 分類(自動化機器・用手法)は見出しセルが空なので「方法」列の右隣を読む。
          classification: ExcelSource.cell_string(sheet, row, columns[:name] + 1),
          product_name: columns[:product_name] && ExcelSource.cell_string(sheet, row, columns[:product_name]),
          company: columns[:company] && ExcelSource.cell_string(sheet, row, columns[:company]),
          note: columns[:note] && ExcelSource.cell_string(sheet, row, columns[:note]),
          source: Master::MicroSusceptibilityMethod::OFFICIAL,
          display_order: display_order,
          # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
          search_name: Master::SearchNormalizer.normalize(name),
          created_at: now,
          updated_at: now
        }
      end
    end

    # 施設追加コードと同じコードを配布ファイルが載せてきたら、どのコードが
    # 問題かを示して取込ごと止める(片側だけ入った状態を作らない)。
    def reject_local_conflicts(rows)
      local_codes = Master::MicroSusceptibilityMethod.local.pluck(:code).to_set
      conflicts = rows.map { |row| row[:code] }.select { |code| local_codes.include?(code) }
      return if conflicts.empty?

      raise ImportError, "施設追加コードと重複しています: #{conflicts.join(', ')}"
    end
  end
end
