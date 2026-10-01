module MasterImport
  # 厚生労働省の診断群分類(DPC)電子点数表(Excel)から、ICD-10 → 診断群分類上6桁の
  # 対応表(「４）ＩＣＤ」シート)を master_dpc_icd_codes へ全件洗い替えで取り込む。
  #
  # シートはヘッダー2行(2行目は有効期間の「開始日 / 終了日」)に続いて
  # [MDCコード / 分類コード / ICD名称 / ICDコード / 変更区分 / 有効期間 開始日 / 終了日 / 更新日]
  # が並ぶ。ICD コードは小数点なしで、次の表記がある。
  #
  #   "C700" "M0740" "I10"  そのコードだけ(完全一致)
  #   "I50$" "I700$"        その文字列で始まるコードすべて(前方一致)
  #   "M!!!!"               表に掲げたコード以外の M コードすべて(受け皿)
  #
  # 列の位置はヘッダーの見出しから決める。読めない表記の ICD コードがあれば、
  # 誤った対応を入れないよう取込全体を止める。
  class DpcIcdCodeImporter
    Result = Struct.new(:imported_count, keyword_init: true)

    BATCH_SIZE = 1000

    HEADERS = {
      mdc: "MDCコード",
      classification: "分類コード",
      icd_name: "ICD名称",
      icd_code: "ICDコード",
      valid_from: "有効期間"
    }.freeze

    EXACT_PATTERN = /\A[A-Z]\d{2,4}\z/
    PREFIX_PATTERN = /\A([A-Z]\d{2,3})\$\z/
    FALLBACK_PATTERN = /\A([A-Z])!+\z/

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      rows = ExcelSource.open(file) { |workbook| build_rows(icd_sheet(workbook)) }
      raise ImportError, "ICD コードが 1 件も読み取れませんでした" if rows.empty?

      ActiveRecord::Base.transaction do
        Master::DpcIcdCode.delete_all
        rows.each_slice(BATCH_SIZE) { |slice| Master::DpcIcdCode.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    # シート名は「４）ＩＣＤ」。全角・半角のゆれを吸収して探す。
    def icd_sheet(workbook)
      name = workbook.sheets.find { |sheet_name| ExcelSource.normalize_label(sheet_name).upcase.end_with?(")ICD") }
      raise ImportError, "「４）ＩＣＤ」のシートが見つかりません" if name.nil?

      workbook.sheet(name)
    end

    def build_rows(sheet)
      header_row = ExcelSource.find_header_row(sheet, [HEADERS[:icd_code]])
      raise ImportError, "ヘッダー行(ICDコード)が見つかりません" if header_row.nil?

      columns = header_columns(sheet, header_row)
      now = Time.current

      ((header_row + 1)..sheet.last_row.to_i).filter_map do |row|
        mdc = ExcelSource.cell_string(sheet, row, columns[:mdc])
        # ヘッダーの2行目(開始日 / 終了日)と空行を飛ばす。
        next unless /\A\d{1,2}\z/.match?(mdc.to_s)

        classification = ExcelSource.cell_string(sheet, row, columns[:classification])
        # 分類コードは 4 桁で、末尾が "x" のもの("021x")もある。
        unless /\A(\d{1,4}|\d{3}x)\z/.match?(classification.to_s)
          raise ImportError, "row #{row}: 分類コード「#{classification}」が読み取れません"
        end

        icd_pattern = normalize_icd_pattern(ExcelSource.cell_string(sheet, row, columns[:icd_code]))
        icd10, match_type = parse_icd(icd_pattern, row)

        {
          # 数値セルで入っていても桁が落ちないよう 0 埋めする。
          mdc6: mdc.rjust(2, "0") + classification.rjust(4, "0"),
          icd10: icd10,
          match_type: match_type,
          icd_pattern: icd_pattern,
          icd_name: ExcelSource.cell_string(sheet, row, columns[:icd_name]),
          valid_from: ExcelSource.cell_string(sheet, row, columns[:valid_from]),
          # 終了日は「有効期間」の見出しの右隣の列。
          valid_to: ExcelSource.cell_string(sheet, row, columns[:valid_from] + 1),
          created_at: now,
          updated_at: now
        }
      end
    end

    def header_columns(sheet, header_row)
      labels = (1..sheet.last_column.to_i).to_h do |column|
        [ExcelSource.normalize_label(ExcelSource.cell_string(sheet, header_row, column)), column]
      end

      HEADERS.transform_values do |label|
        labels[label] || raise(ImportError, "ヘッダーに「#{label}」の列がありません")
      end
    end

    # 全角・小文字・小数点が混ざっても同じ表記にそろえる("i50.$" → "I50$")。
    def normalize_icd_pattern(text)
      text.to_s.unicode_normalize(:nfkc).upcase.gsub(/[[:space:].]/, "")
    end

    def parse_icd(icd_pattern, row)
      case icd_pattern
      when EXACT_PATTERN then [icd_pattern, Master::DpcIcdCode::EXACT]
      when PREFIX_PATTERN then [::Regexp.last_match(1), Master::DpcIcdCode::PREFIX]
      when FALLBACK_PATTERN then [::Regexp.last_match(1), Master::DpcIcdCode::FALLBACK]
      else raise ImportError, "row #{row}: ICD コード「#{icd_pattern}」の表記を解釈できません"
      end
    end
  end
end
