module MasterImport
  # 厚生労働省 通知「基本診療料の施設基準等及びその届出に関する手続きの取扱いについて」の
  # 別紙7 別表1(一般病棟用の重症度、医療・看護必要度 A・C 項目に係るレセプト電算処理システム用コード一覧)と
  # 別表2(「A3 注射薬剤3種類以上の管理」で薬剤の種類数の対象から除くもの)の Excel を、
  # master_nursing_acuity_codes へ取り込む。どちらのファイルかは先頭シートの表題で見分け、
  # その種類(kind)だけを全件洗い替えする。新旧対照・見え消しのシートは読まない(先頭シートだけ)。
  #
  # 別表1 の先頭シート: 3 行目が見出し、4 行目から A 列 区分(Ａ/Ｃ)、B 列 項目番号、C 列 項目名、
  # D 列 コード、E 列 名称、F 列「※」(必要度Ⅰだけで用いる)。結合セルの続きは A〜C 列が空なので、
  # 直前の行の値を引き継ぐ。A3 はコードではなく規則の行(「別紙７別表２の薬剤を除く、注射薬剤の種類数」)
  # なので取り込まない(A3 は注射薬の種類数で判定する)。
  # 別表2 の先頭シート: 2 行目が見出し、3 行目から A 列 コード、B 列 名称。
  class NursingAcuityCodeImporter
    CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫".chars.freeze

    Result = Struct.new(:imported_count, :skipped_count, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      kind, rows, skipped = ExcelSource.open(file) do |workbook|
        sheet = workbook.sheet(0)
        title = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, 1, 1))
        if title.include?("別表1") && title.include?("一般病棟用")
          ["item", *item_rows(sheet)]
        elsif title.include?("別表2") && title.include?("一般病棟用")
          ["a3_exclusion", *exclusion_rows(sheet)]
        else
          raise ImportError, "看護必要度の別紙7 別表1(コード一覧)か別表2(A3 の除外薬剤)の Excel を選んでください"
        end
      end
      raise ImportError, "コードが 1 件も読み取れませんでした" if rows.empty?

      ActiveRecord::Base.transaction do
        Master::NursingAcuityCode.where(kind: kind).delete_all
        Master::NursingAcuityCode.insert_all!(rows.map { |row| row.merge(kind: kind, created_at: now, updated_at: now) })
      end

      Result.new(imported_count: rows.size, skipped_count: skipped)
    end

    private

    attr_reader :file

    def now
      @now ||= Time.current
    end

    def item_rows(sheet)
      rows = []
      skipped = 0
      group = number = label = nil
      (4..sheet.last_row.to_i).each do |row|
        group = ExcelSource.cell_string(sheet, row, 1) || group
        number = ExcelSource.cell_string(sheet, row, 2) || number
        label = ExcelSource.cell_string(sheet, row, 3) || label
        code = ExcelSource.cell_string(sheet, row, 4)
        next if code.blank?

        item_code = item_code_of(group, number, label)
        # A3 は規則の行(コードの欄に「別紙７別表２の薬剤を除く、注射薬剤の種類数」)なので取り込まない。
        next if item_code == "A3"
        next skipped += 1 unless code.match?(/\A\d{9}\z/)
        next skipped += 1 if item_code.nil?

        rows << {
          item_code: item_code,
          item_label: label,
          code: code,
          name: ExcelSource.cell_string(sheet, row, 5),
          form_i_only: ExcelSource.cell_string(sheet, row, 6).to_s.include?("※"),
          days: days_of(label),
          display_order: rows.size + 1
        }
      end
      [rows, skipped]
    end

    def exclusion_rows(sheet)
      rows = []
      skipped = 0
      (3..sheet.last_row.to_i).each do |row|
        code = ExcelSource.cell_string(sheet, row, 1)
        next if code.blank?
        next skipped += 1 unless code.match?(/\A\d{9}\z/)

        rows << {
          item_code: "A3",
          code: code,
          name: ExcelSource.cell_string(sheet, row, 2),
          form_i_only: false,
          display_order: rows.size + 1
        }
      end
      [rows, skipped]
    end

    # "Ａ" + "6" + "専門的な治療・処置（① …）" → "A6-1"、"Ｃ" + "21" + "…（①経皮的血管内治療）" → "C21"。
    # A6 だけは小項目ごとに点数が違うので小項目まで持つ(C21 の①〜③は点数が同じなので項目でまとめる)。
    def item_code_of(group, number, label)
      letter = group.to_s.unicode_normalize(:nfkc).strip
      digits = number.to_s.unicode_normalize(:nfkc).strip
      return nil unless %w[A C].include?(letter) && digits.match?(/\A\d+\z/)

      if letter == "A" && digits == "6"
        index = CIRCLED.index { |circled| label.to_s.include?(circled) }
        return index ? "A6-#{index + 1}" : nil
      end
      "#{letter}#{digits}"
    end

    # "開頭手術（11日間）" → 11。
    def days_of(label)
      label.to_s.unicode_normalize(:nfkc)[/(\d+)日間/, 1]&.to_i
    end
  end
end
