module MasterImport
  # JJ1017 の代表的頻用コード集(別表F)を master_rad_jj1017_frequent_codes へ
  # 取り込む。1ファイルに放射線検査・超音波検査・放射線治療の3シートが入っており、
  # まとめて全件洗い替えする。
  #
  # シートの構造はどれも同じで、2行目が「番号 / JJ1017-32コード / コード意味」の
  # ヘッダー、3行目からコードが並ぶ。
  #
  # 配布ファイルには32桁になっていない行が混じっている(Ver3.3 の別表F2 に162行)。
  # 取り込めない行は件数を返して画面に見せる。
  class RadFrequentCodeImporter
    SHEET_CATEGORIES = {
      /\A別表F1/ => "rad_exam",
      /\A別表F2/ => "ultrasound",
      /\A別表F3/ => "radiotherapy"
    }.freeze

    Result = Struct.new(:imported_count, :skipped_count, :category_counts, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
      @skipped_count = 0
    end

    def call
      rows = parse_rows
      raise ImportError, "JJ1017 の別表F シートが見つかりません" if rows.empty?

      ActiveRecord::Base.transaction do
        Master::RadJj1017FrequentCode.delete_all
        rows.each_slice(1000) { |slice| Master::RadJj1017FrequentCode.insert_all!(slice) }
      end

      Result.new(
        imported_count: rows.size,
        skipped_count: @skipped_count,
        category_counts: rows.group_by { |row| row[:category] }.transform_values(&:size)
      )
    end

    private

    attr_reader :file

    def parse_rows
      ExcelSource.open(file) do |workbook|
        now = Time.current
        workbook.sheets.flat_map do |sheet_name|
          category = category_for(sheet_name)
          next [] if category.nil?

          parse_sheet(workbook.sheet(sheet_name), category, now)
        end
      end
    end

    def category_for(sheet_name)
      normalized = ExcelSource.normalize_label(sheet_name)
      SHEET_CATEGORIES.find { |pattern, _| pattern.match?(normalized) }&.last
    end

    def parse_sheet(sheet, category, now)
      header_row = ExcelSource.find_header_row(sheet, ["コード意味"])
      raise ImportError, "「コード意味」の見出し行が見つかりません" if header_row.nil?

      columns = header_columns(sheet, header_row)
      raise ImportError, "「JJ1017-32コード」の列が見つかりません" if columns[:code].nil?

      seen = Set.new
      ((header_row + 1)..sheet.last_row.to_i).filter_map do |row|
        code = ExcelSource.cell_string(sheet, row, columns[:code])
        name = ExcelSource.cell_string(sheet, row, columns[:name])
        next if code.blank? && name.blank?

        # 桁数不足・重複は取り込めないので件数だけ数えて捨てる(重複は先勝ち)。
        if code.to_s.length != Master::Jj1017Code::CODE_LENGTH || name.blank? || !seen.add?(code)
          @skipped_count += 1
          next
        end

        {
          category: category,
          jj1017_code: code,
          name: name,
          display_order: columns[:display_order] &&
            ExcelSource.cell_string(sheet, row, columns[:display_order])&.to_i,
          # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
          search_name: Master::SearchNormalizer.normalize(name),
          created_at: now,
          updated_at: now
        }
      end
    end

    def header_columns(sheet, header_row)
      (1..sheet.last_column.to_i).each_with_object({}) do |column, map|
        label = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, header_row, column))
        next if label.blank?

        map[:code] ||= column if label.include?("32")
        map[:name] ||= column if label == "コード意味"
        map[:display_order] ||= column if label == "番号"
      end
    end
  end
end
