module MasterImport
  # JANIS 検査部門の抗菌薬コード表(antimicrobialdrugcode_ver*.xls)を
  # master_micro_antimicrobials へ取り込む。
  #
  # 配布ファイルは「抗菌薬コード一覧」シート(最新版のみ)と「全バージョン」シートを
  # 持つので、「一覧」を含む名前のシートを読む。ヘッダー行は無く、3行目から
  # [コード / 和名 / 略号 / 商品名] が並ぶ。系統見出し行(1200 ペニシリン系 など)は
  # 和名が行頭から書かれ、薬剤行は和名が空白(全角・半角が混在)で字下げされている
  # ことで見分ける。見出し行は薬剤として保存せず、後続の薬剤行の category にする。
  #
  # source=official のみ全件洗い替えし、施設追加分(source=local)と、画面で
  # 選んだ頻用薬の印(frequent)はコードをキーに温存する。
  class MicroAntimicrobialImporter
    Result = Struct.new(:imported_count, :skipped_count, :sheet_name, keyword_init: true)

    CODE_COLUMN = 1
    NAME_COLUMN = 2
    ABBREVIATION_COLUMN = 3
    BRAND_NAME_COLUMN = 4

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
        frequent_codes = Master::MicroAntimicrobial.frequent.pluck(:code).to_set
        rows.each { |row| row[:frequent] = frequent_codes.include?(row[:code]) }

        Master::MicroAntimicrobial.official.delete_all
        rows.each_slice(1000) { |slice| Master::MicroAntimicrobial.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size, skipped_count: @skipped_count, sheet_name: @sheet_name)
    end

    private

    attr_reader :file

    def parse_rows
      ExcelSource.open(file) do |workbook|
        @sheet_name = workbook.sheets.find { |name| name.include?("一覧") }
        raise ImportError, "「抗菌薬コード一覧」のシートが見つかりません" if @sheet_name.nil?

        build_rows(workbook.sheet(@sheet_name))
      end
    end

    def build_rows(sheet)
      seen = Set.new
      now = Time.current
      display_order = 0
      category = nil

      (1..sheet.last_row.to_i).filter_map do |row|
        code = ExcelSource.cell_string(sheet, row, CODE_COLUMN)
        raw_name = sheet.cell(row, NAME_COLUMN).to_s
        # String#strip は全角空白(字下げに使われている)を落とさないので明示的に除く。
        name = raw_name.gsub(/\A[[:space:]]+|[[:space:]]+\z/, "")
        next if code.blank? && name.blank? # タイトル行など

        # コードが数字でない・名称なし・重複の行は取り込めないので件数だけ数えて捨てる。
        if !/\A\d+\z/.match?(code.to_s) || name.blank? || !seen.add?(code)
          @skipped_count += 1
          next
        end

        # 和名が字下げされていない行は系統見出し。薬剤としては保存しない。
        unless /\A[[:space:]]/.match?(raw_name)
          category = name
          next
        end

        display_order += 10
        {
          code: code,
          name: name,
          abbreviation: ExcelSource.cell_string(sheet, row, ABBREVIATION_COLUMN),
          brand_name: ExcelSource.cell_string(sheet, row, BRAND_NAME_COLUMN),
          category: category,
          source: Master::MicroAntimicrobial::OFFICIAL,
          display_order: display_order,
          # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
          search_name: Master::SearchNormalizer.normalize(name),
          search_abbreviation: Master::SearchNormalizer.normalize(
            ExcelSource.cell_string(sheet, row, ABBREVIATION_COLUMN)
          ),
          created_at: now,
          updated_at: now
        }
      end
    end

    # 施設追加コードと同じコードを配布ファイルが載せてきたら、どのコードが
    # 問題かを示して取込ごと止める(片側だけ入った状態を作らない)。
    def reject_local_conflicts(rows)
      local_codes = Master::MicroAntimicrobial.local.pluck(:code).to_set
      conflicts = rows.map { |row| row[:code] }.select { |code| local_codes.include?(code) }
      return if conflicts.empty?

      raise ImportError, "施設追加コードと重複しています: #{conflicts.join(', ')}"
    end
  end
end
