module MasterImport
  # 厚生労働省の DPC 電子点数表(Excel)の全シートを master_dpc_* に取り込む。
  #
  # 版(edition)は「１）ＭＤＣ名称」の有効期間の開始日のうち最も古いもの(改定の開始日)。
  # 同じ版の行だけを入れ替えるので、改定前の版は残り、改定をまたぐ入院も退院日の版で判定できる。
  # 月々の見直し版を取り込み直したときは、その版の行が新しいファイルの内容に置き換わる。
  #
  # 列の位置は配布ファイルの書式(前提条件シート)に従って決め打ちし、見出しの文言で
  # 書式が変わっていないことを確かめる。変換テーブルだけは列が多いので見出しから引く。
  # 読めない行があれば、誤った分類を入れないよう取込全体を止める。
  class DpcTableImporter
    Result = Struct.new(:imported_count, :elements, keyword_init: true)

    BATCH_SIZE = 1000
    MDC_PATTERN = /\A\d{1,2}\z/
    CLASSIFICATION_PATTERN = /\A(\d{1,4}|\d{3}x)\z/
    DPC_CODE_PATTERN = /\A\d{5}[\dx][\dxA-Z]{8}\z/

    # シート名(全角・空白を詰めた形)の先頭。
    SHEETS = {
      mdc: "1)MDC名称",
      classification: "2)分類名称",
      pathology: "3)病態等分類",
      age_group: "5)年齢",
      surgery: "6)手術",
      proc1: "7)手術・処置等1",
      proc2: "8)手術・処置等2",
      comorbidity: "9)定義副傷病",
      severity_range: "10-1)",
      severity_surgery: "10-2)",
      severity_pancreatitis: "10-3)",
      severity_category: "10-4)",
      points: "11)",
      conversion: "12)",
      fee_for_service: "13)",
      ccpm: "14)",
      dummy: "ダミーコード"
    }.freeze

    LABELS = {
      mdc: "MDC", classification: "分類名称", pathology: "病態等分類", age_group: "年齢、出生時体重等",
      surgery: "手術", proc1: "手術・処置等1", proc2: "手術・処置等2", comorbidity: "定義副傷病名",
      severity: "重症度等", points: "診断群分類点数表", conversion: "変換テーブル",
      fee_for_service: "出来高算定手術等コード", ccpm: "CCPM対応", dummy: "ダミーコード", icd: "ICD"
    }.freeze

    # 13）出来高算定手術等コード は区分ごとに見出しが繰り返される。3 列目の見出しで種類を決める。
    FEE_FOR_SERVICE_KINDS = {
      "手術コード名称" => "surgery", "検査名称" => "test", "対象患者" => "patient", "薬剤名称" => "drug"
    }.freeze

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      tables = ExcelSource.open(file) { |workbook| read(workbook) }
      edition = tables[:classifications].filter_map { |row| row[:valid_from] }.min
      raise ImportError, "MDC 名称の有効期間(開始日)が読み取れません" unless edition.to_s.match?(/\A\d{8}\z/)

      counts = save(edition, tables)
      Result.new(imported_count: counts.values.sum, elements: counts.transform_keys { |key| LABELS[key] })
    end

    private

    attr_reader :file

    def read(workbook)
      @workbook = workbook
      mdcs = classification_rows(:mdc, "mdc")
      raise ImportError, "MDC 名称が 1 件も読み取れません" if mdcs.empty?

      {
        classifications: mdcs + classification_rows(:classification, "classification"),
        conditions: pathology_rows + age_group_rows + severity_range_rows(:severity_range, "10-1") +
          severity_surgery_rows + severity_range_rows(:severity_pancreatitis, "10-3") + severity_category_rows,
        icd: DpcIcdSheet.rows(workbook),
        surgeries: surgery_rows,
        procedures: procedure_rows(:proc1, 1) + procedure_rows(:proc2, 2),
        comorbidities: comorbidity_rows,
        points: point_rows,
        conversions: conversion_rows,
        fee_for_service: fee_for_service_rows,
        ccpms: ccpm_rows,
        dummies: dummy_rows
      }
    end

    def save(edition, tables)
      now = Time.current
      targets = {
        mdc: [Master::DpcClassification, tables[:classifications]],
        icd: [Master::DpcIcdCode, tables[:icd]],
        severity: [Master::DpcCondition, tables[:conditions]],
        surgery: [Master::DpcSurgery, tables[:surgeries]],
        proc1: [Master::DpcProcedure, tables[:procedures]],
        comorbidity: [Master::DpcComorbidity, tables[:comorbidities]],
        points: [Master::DpcPoint, tables[:points]],
        conversion: [Master::DpcConversion, tables[:conversions]],
        fee_for_service: [Master::DpcFeeForServiceCode, tables[:fee_for_service]],
        ccpm: [Master::DpcCcpm, tables[:ccpms]],
        dummy: [Master::DpcDummyCode, tables[:dummies]]
      }

      ActiveRecord::Base.transaction do
        targets.each_value do |model, rows|
          model.where(edition: edition).delete_all
          # insert_all は全行が同じ列を持つ必要がある(条件のシートごとに持つ列が違う)。
          keys = rows.flat_map(&:keys).uniq
          rows = rows.map { |row| keys.index_with { nil }.merge(row) }
          rows.each_slice(BATCH_SIZE) do |slice|
            model.insert_all!(slice.map { |row| row.merge(edition: edition, created_at: now, updated_at: now) })
          end
        end

        counts = {
          mdc: tables[:classifications].count { |row| row[:level] == "mdc" },
          classification: tables[:classifications].count { |row| row[:level] == "classification" },
          icd: tables[:icd].size,
          surgery: tables[:surgeries].size,
          proc1: tables[:procedures].count { |row| row[:kind] == 1 },
          proc2: tables[:procedures].count { |row| row[:kind] == 2 },
          comorbidity: tables[:comorbidities].size,
          severity: tables[:conditions].size,
          points: tables[:points].size,
          conversion: tables[:conversions].size,
          fee_for_service: tables[:fee_for_service].size,
          ccpm: tables[:ccpms].size,
          dummy: tables[:dummies].size
        }
        edition_record = Master::DpcEdition.find_or_initialize_by(edition: edition)
        edition_record.update!(source_filename: source_filename, counts: counts.transform_keys(&:to_s),
                               imported_at: now)
        counts
      end
    end

    def source_filename
      file.try(:original_filename) || File.basename(file.try(:path).to_s)
    end

    # --- シートと列 ---

    # Roo の sheet は既定のシートを切り替えてブック自身を返すので、シート名は別に覚えておく
    # (エラーの文言に使う)。
    def sheet(key)
      prefix = SHEETS.fetch(key)
      name = @workbook.sheets.find { |sheet_name| ExcelSource.normalize_label(sheet_name).start_with?(prefix) }
      raise ImportError, "「#{prefix}」のシートが見つかりません" if name.nil?

      @sheet_name = name.strip
      sheet = @workbook.sheet(name)
      # 表が B 列から始まるシートがある(11）診断群分類点数表)。列の位置は表の左端からの番号で扱う。
      @column_offset = sheet.first_column.to_i - 1
      sheet
    end

    def last_column(sheet)
      sheet.last_column.to_i - @column_offset
    end

    def cell(sheet, row, column)
      ExcelSource.cell_string(sheet, row, column + @column_offset)
    end

    # 変更区分・有効期間の列は見出しの文言で探す(シートごとに位置が違う)。
    def validity_columns(sheet)
      header_row = ExcelSource.find_header_row(sheet, ["変更区分"])
      raise ImportError, "「#{sheet_label(sheet)}」に変更区分の見出しがありません" if header_row.nil?

      labels = (1..last_column(sheet)).to_h do |column|
        [ExcelSource.normalize_label(cell(sheet, header_row, column)), column]
      end
      valid_from = labels["有効期間"] || raise(ImportError, "「#{sheet_label(sheet)}」に有効期間の見出しがありません")
      { header_row: header_row, change: labels["変更区分"], valid_from: valid_from, valid_to: valid_from + 1 }
    end

    def sheet_label(_sheet)
      @sheet_name
    end

    def validity(sheet, row, columns)
      {
        change_category: cell(sheet, row, columns[:change]),
        valid_from: cell(sheet, row, columns[:valid_from]),
        valid_to: cell(sheet, row, columns[:valid_to])
      }
    end

    # MDC コード・分類コードを持つデータ行を順に返す(見出しの 2 行目や空行を飛ばす)。
    def each_data_row(sheet, columns)
      ((columns[:header_row] + 1)..sheet.last_row.to_i).each do |row|
        mdc = cell(sheet, row, 1)
        next unless MDC_PATTERN.match?(mdc.to_s)

        yield row, mdc.rjust(2, "0")
      end
    end

    def mdc6(sheet, row, mdc)
      classification = cell(sheet, row, 2).to_s
      unless CLASSIFICATION_PATTERN.match?(classification)
        raise ImportError, "「#{sheet_label(sheet)}」row #{row}: 分類コード「#{classification}」が読み取れません"
      end

      mdc + classification.rjust(4, "0")
    end

    def int_or_nil(text)
      text.to_s.match?(/\A\d+\z/) ? text.to_i : nil
    end

    # --- シートごとの行 ---

    def classification_rows(key, level)
      sheet = sheet(key)
      columns = validity_columns(sheet)
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        code, name = level == "mdc" ? [mdc, cell(sheet, row, 2)] : [mdc6(sheet, row, mdc), cell(sheet, row, 3)]
        rows << { code: code, level: level, name: name.to_s, **validity(sheet, row, columns) }
      end
      rows
    end

    # 3）病態等分類: 年齢の範囲と院内肺炎・市中肺炎の区分の両方を満たすとき対応コード。
    def pathology_rows
      sheet = sheet(:pathology)
      columns = validity_columns(sheet)
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        rows << {
          mdc6: mdc6(sheet, row, mdc), sheet: "3", condition_kind: nil, condition_name: "病態等分類",
          code_value: cell(sheet, row, 3), flag: cell(sheet, row, 4),
          category: cell(sheet, row, 7), category_name: cell(sheet, row, 8),
          ranges: [range(sheet, row, 5, 6, cell(sheet, row, 3))].compact, options: [],
          **validity(sheet, row, columns)
        }
      end
      rows
    end

    # 5）年齢、出生時体重等: 条件区分ごとに「以上・未満・値」の組が最大 5 つ。
    def age_group_rows
      sheet = sheet(:age_group)
      columns = validity_columns(sheet)
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        ranges = [5, 8, 11, 14, 17].filter_map { |col| range(sheet, row, col, col + 1, cell(sheet, row, col + 2)) }
        rows << {
          mdc6: mdc6(sheet, row, mdc), sheet: "5", condition_kind: cell(sheet, row, 3),
          condition_name: cell(sheet, row, 4), ranges: ranges, options: [], **validity(sheet, row, columns)
        }
      end
      rows
    end

    # 10－1）・10－3）: 条件区分ごとに「以上・未満・値」の組。
    def severity_range_rows(key, sheet_name)
      sheet = sheet(key)
      columns = validity_columns(sheet)
      starts = (5...columns[:change]).step(3).to_a
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        ranges = starts.filter_map { |col| range(sheet, row, col, col + 1, cell(sheet, row, col + 2)) }
        rows << {
          mdc6: mdc6(sheet, row, mdc), sheet: sheet_name, condition_kind: cell(sheet, row, 3),
          condition_name: cell(sheet, row, 4), ranges: ranges, options: [], **validity(sheet, row, columns)
        }
      end
      rows
    end

    # 10－2）: 「片眼 → 0 / 両眼 → 1」のような 2 択。
    def severity_surgery_rows
      sheet = sheet(:severity_surgery)
      columns = validity_columns(sheet)
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        options = [[5, 6], [7, 8]].filter_map do |label_col, value_col|
          label = cell(sheet, row, label_col)
          value = cell(sheet, row, value_col)
          { "label" => label, "value" => value } if label && value
        end
        rows << {
          mdc6: mdc6(sheet, row, mdc), sheet: "10-2", condition_kind: cell(sheet, row, 3),
          condition_name: cell(sheet, row, 4), ranges: [], options: options, **validity(sheet, row, columns)
        }
      end
      rows
    end

    # 10－4）: 区分(発症時期・スコア・点数)ごとの対応コード。
    def severity_category_rows
      sheet = sheet(:severity_category)
      columns = validity_columns(sheet)
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        rows << {
          mdc6: mdc6(sheet, row, mdc), sheet: "10-4", code_value: cell(sheet, row, 3), flag: cell(sheet, row, 4),
          condition_kind: cell(sheet, row, 5), condition_name: cell(sheet, row, 6),
          category: cell(sheet, row, 7), category_name: cell(sheet, row, 8), ranges: [], options: [],
          **validity(sheet, row, columns)
        }
      end
      rows
    end

    def range(sheet, row, min_col, max_col, value)
      min = int_or_nil(cell(sheet, row, min_col))
      max = int_or_nil(cell(sheet, row, max_col))
      return nil if min.nil? || max.nil? || value.nil?

      { "min" => min, "max" => max, "value" => value }
    end

    # 6）手術: 手術1〜5(点数表名称・Ｋコード の組)をすべて実施したとき該当。
    def surgery_rows
      sheet = sheet(:surgery)
      columns = validity_columns(sheet)
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        pairs = [7, 9, 11, 13, 15].filter_map do |col|
          code = cell(sheet, row, col + 1)
          [code, cell(sheet, row, col).to_s] if code
        end
        raise ImportError, "「#{sheet_label(sheet)}」row #{row}: Ｋコードがありません" if pairs.empty?

        rows << {
          mdc6: mdc6(sheet, row, mdc), flag: cell(sheet, row, 4).to_s, code_value: cell(sheet, row, 6).to_s,
          codes: pairs.map(&:first), names: pairs.map(&:last), **validity(sheet, row, columns)
        }
      end
      rows
    end

    # 7）・8）: 処置等(1)(2) の組。7）だけ「手術との組み合わせ条件」の列がある。
    def procedure_rows(key, kind)
      sheet = sheet(key)
      columns = validity_columns(sheet)
      starts = kind == 1 ? [6, 8] : [5, 7]
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        pairs = starts.filter_map do |col|
          code = cell(sheet, row, col + 1)
          [code, cell(sheet, row, col).to_s] if code
        end
        raise ImportError, "「#{sheet_label(sheet)}」row #{row}: 処置のコードがありません" if pairs.empty?

        rows << {
          mdc6: mdc6(sheet, row, mdc), kind: kind, flag: cell(sheet, row, 4).to_s,
          code_value: cell(sheet, row, 3).to_s, surgery_condition: kind == 1 ? cell(sheet, row, 5) : nil,
          codes: pairs.map(&:first), names: pairs.map(&:last), **validity(sheet, row, columns)
        }
      end
      rows
    end

    # 9）定義副傷病名: ICD は完全一致か「$」の前方一致。
    def comorbidity_rows
      sheet = sheet(:comorbidity)
      columns = validity_columns(sheet)
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        pattern = DpcIcdSheet.normalize_icd_pattern(cell(sheet, row, 6))
        icd10, match_type = DpcIcdSheet.parse_icd(pattern, row, allow_fallback: false)
        rows << {
          mdc6: mdc6(sheet, row, mdc), code_value: cell(sheet, row, 3).to_s, flag: cell(sheet, row, 4).to_s,
          icd10: icd10, match_type: match_type, icd_pattern: pattern, icd_name: cell(sheet, row, 5),
          **validity(sheet, row, columns)
        }
      end
      rows
    end

    # 11）診断群分類点数表: 入院日・点数の「-」と空欄は持たない(包括対象外・期間Ⅱの無い分類)。
    def point_rows
      sheet = sheet(:points)
      columns = validity_columns(sheet)
      ((columns[:header_row] + 1)..sheet.last_row.to_i).filter_map do |row|
        code = cell(sheet, row, 2)
        next unless code.to_s.match?(DPC_CODE_PATTERN)

        {
          serial: int_or_nil(cell(sheet, row, 1)), dpc_code: code,
          disease_name: cell(sheet, row, 3), surgery_name: cell(sheet, row, 4),
          proc1_name: cell(sheet, row, 5), proc2_name: cell(sheet, row, 6),
          comorbidity_name: cell(sheet, row, 7), severity_name: cell(sheet, row, 8),
          days1: int_or_nil(cell(sheet, row, 9)), days2: int_or_nil(cell(sheet, row, 10)),
          days3: int_or_nil(cell(sheet, row, 11)),
          points1: int_or_nil(cell(sheet, row, 12)), points2: int_or_nil(cell(sheet, row, 13)),
          points3: int_or_nil(cell(sheet, row, 14)),
          **validity(sheet, row, columns)
        }
      end
    end

    # 12）変換テーブル: 分岐の列は見出し(親・子)から引く。
    def conversion_rows
      sheet = sheet(:conversion)
      columns = validity_columns(sheet)
      branch_columns = conversion_branch_columns(sheet, columns)

      ((columns[:header_row] + 2)..sheet.last_row.to_i).filter_map do |row|
        code = cell(sheet, row, 2)
        next unless code.to_s.match?(DPC_CODE_PATTERN)

        mdc = cell(sheet, row, 4).to_s.rjust(2, "0")
        values = branch_columns.each_with_object({}) do |(key, column), hash|
          value = cell(sheet, row, column)
          hash[key] = value if value
        end
        {
          serial: int_or_nil(cell(sheet, row, 1)), dpc_code: code, mdc6: mdc6_of(sheet, row, mdc, 5),
          bundled: cell(sheet, row, 3) == "1", branch_values: values, **validity(sheet, row, columns)
        }
      end
    end

    def mdc6_of(sheet, row, mdc, column)
      classification = cell(sheet, row, column).to_s
      unless CLASSIFICATION_PATTERN.match?(classification)
        raise ImportError, "「#{sheet_label(sheet)}」row #{row}: 分類コード「#{classification}」が読み取れません"
      end

      mdc + classification.rjust(4, "0")
    end

    def conversion_branch_columns(sheet, columns)
      header = columns[:header_row]
      parent = nil
      found = {}
      (6...columns[:change]).each do |column|
        parent_label = ExcelSource.normalize_label(cell(sheet, header, column)).presence
        parent = parent_label if parent_label
        child = ExcelSource.normalize_label(cell(sheet, header + 1, column)).presence
        key = Dpc::Branches::CONVERSION_COLUMNS[[parent, child]]
        raise ImportError, "変換テーブルの列「#{[parent, child].compact.join(' / ')}」を解釈できません" if key.nil?

        found[key] = column
      end
      missing = %w[surgery proc1 proc2 comorbidity] - found.keys
      raise ImportError, "変換テーブルに #{missing.join('・')} の列がありません" if missing.any?

      found
    end

    # 13）出来高算定手術等コード: 区分ごとに見出しが繰り返される。
    def fee_for_service_rows
      sheet = sheet(:fee_for_service)
      columns = validity_columns(sheet)
      kind = nil
      (1..sheet.last_row.to_i).filter_map do |row|
        label = ExcelSource.normalize_label(cell(sheet, row, 3))
        if ExcelSource.normalize_label(cell(sheet, row, 1)) == "区分コード"
          kind = FEE_FOR_SERVICE_KINDS[label] || raise(ImportError, "出来高算定手術等コードの見出し「#{label}」を解釈できません")
          next
        end
        category = cell(sheet, row, 1)
        next unless kind && category.to_s.match?(/\A\d{2}\z/)

        { kind: kind, category: category, code: cell(sheet, row, 2), name: cell(sheet, row, 3),
          **validity(sheet, row, columns) }
      end
    end

    def ccpm_rows
      sheet = sheet(:ccpm)
      columns = validity_columns(sheet)
      rows = []
      each_data_row(sheet, columns) do |row, mdc|
        rows << { mdc6: mdc6(sheet, row, mdc), dpc_code: cell(sheet, row, 3).to_s,
                  ccpm_code: cell(sheet, row, 4).to_s, **validity(sheet, row, columns) }
      end
      rows
    end

    def dummy_rows
      sheet = sheet(:dummy)
      (1..sheet.last_row.to_i).filter_map do |row|
        code = cell(sheet, row, 3)
        name = cell(sheet, row, 4)
        next unless code.to_s.match?(/\A[A-Z0-9]{4}\z/) && name

        { code: code, name: name, note: cell(sheet, row, 5) }
      end
    end
  end
end
