module MasterImport
  # 厚生労働省「（別表）Kコードに対応する手術基幹コード（STEM7）」(Excel)から
  # master_dpc_stem7_codes へ全件洗い替えで取り込む。
  #
  # 先頭シートの 1 行目が見出しで、A 列が点数表コード("K082 1 ｲ")、B 列が術式名、
  # C 列が STEM7("B28 34 04")、D 列が同じ K コードに複数の STEM7 があるときの注意点。
  # 見出しの文言は年度で変わる("（08年度）" など)ので、先頭の語だけで確かめる。
  class DpcStem7CodeImporter
    HEADERS = { 1 => "診療報酬コード", 3 => "外保連手術試案コード" }.freeze

    Result = Struct.new(:imported_count, :skipped_count, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      rows, skipped = ExcelSource.open(file) { |workbook| build_rows(workbook.sheet(0)) }
      raise ImportError, "STEM7 の対応が 1 件も読み取れませんでした" if rows.empty?

      ActiveRecord::Base.transaction do
        Master::DpcStem7Code.delete_all
        Master::DpcStem7Code.insert_all!(rows.map { |row| row.merge(created_at: now, updated_at: now) })
      end

      Result.new(imported_count: rows.size, skipped_count: skipped)
    end

    private

    attr_reader :file

    def now
      @now ||= Time.current
    end

    def build_rows(sheet)
      check_headers(sheet)
      rows = []
      skipped = 0
      (2..sheet.last_row.to_i).each do |row|
        source = ExcelSource.cell_string(sheet, row, 1)
        stem7 = Master::DpcStem7Code.normalize_stem7(ExcelSource.cell_string(sheet, row, 3))
        next if source.blank? && stem7.blank?

        unless source.present? && stem7.match?(/\A[0-9A-Z]{7}\z/)
          skipped += 1
          next
        end

        rows << {
          k_code: Master::DpcStem7Code.normalize_k_code(source),
          k_code_source: source,
          surgery_name: ExcelSource.cell_string(sheet, row, 2),
          stem7: stem7,
          note: ExcelSource.cell_string(sheet, row, 4),
          display_order: rows.size + 1
        }
      end
      [rows, skipped]
    end

    def check_headers(sheet)
      HEADERS.each do |column, label|
        header = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, 1, column))
        next if header.start_with?(label)

        raise ImportError, "STEM7 の対応表(Kコードに対応する手術基幹コード)の Excel を選んでください"
      end
    end
  end
end
