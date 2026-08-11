module MasterImport
  # JANIS 検査部門の感染症病原体(菌名)コード表(infectiousagentcode_ver*.xls)を
  # master_micro_organisms へ取り込む。
  #
  # 配布ファイルは版ごとのシート("Ver.2.1"〜"Ver.6.1"。"Ver.3.0、3.1" のような
  # 相乗りもある)を持つので、シート名の版番号が最も新しいシートだけを読む。
  # シートは「コード / 菌名」のヘッダー行の下にコードが並ぶ。
  #
  # source=official のみ全件洗い替えし、施設追加分(source=local)と、画面で
  # 選んだ頻用菌の印(frequent)はコードをキーに温存する。
  class MicroOrganismImporter
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
        frequent_codes = Master::MicroOrganism.frequent.pluck(:code).to_set
        rows.each { |row| row[:frequent] = frequent_codes.include?(row[:code]) }

        Master::MicroOrganism.official.delete_all
        rows.each_slice(1000) { |slice| Master::MicroOrganism.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size, skipped_count: @skipped_count, sheet_name: @sheet_name)
    end

    private

    attr_reader :file

    def parse_rows
      ExcelSource.open(file) do |workbook|
        @sheet_name = latest_version_sheet(workbook)
        sheet = workbook.sheet(@sheet_name)

        header_row = ExcelSource.find_header_row(sheet, ["菌名"])
        raise ImportError, "「菌名」の見出し行が見つかりません" if header_row.nil?

        columns = header_columns(sheet, header_row)
        raise ImportError, "「コード」の列が見つかりません" if columns[:code].nil?

        build_rows(sheet, header_row, columns)
      end
    end

    # "Ver.6.1" のような版シートのうち、版番号が最も新しいものを選ぶ。
    # "Ver.3.0、3.1" のように複数版が相乗りしたシートは、その中の最大値で比べる。
    def latest_version_sheet(workbook)
      candidates = workbook.sheets.filter_map do |name|
        next unless /ver/i.match?(name)

        versions = name.scan(/\d+(?:\.\d+)*/)
        next if versions.empty?

        [name, versions.map { |v| Gem::Version.new(v) }.max]
      end
      raise ImportError, "版(Ver.x.x)のシートが見つかりません" if candidates.empty?

      candidates.max_by(&:last).first
    end

    def header_columns(sheet, header_row)
      (1..sheet.last_column.to_i).each_with_object({}) do |column, map|
        label = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, header_row, column))
        next if label.blank?

        map[:code] ||= column if label == "コード"
        map[:name] ||= column if label == "菌名"
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
          source: Master::MicroOrganism::OFFICIAL,
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
      local_codes = Master::MicroOrganism.local.pluck(:code).to_set
      conflicts = rows.map { |row| row[:code] }.select { |code| local_codes.include?(code) }
      return if conflicts.empty?

      raise ImportError, "施設追加コードと重複しています: #{conflicts.join(', ')}"
    end
  end
end
