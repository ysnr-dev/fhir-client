module MasterImport
  # 厚生労働省 通知「基本診療料の施設基準等及びその届出に関する手続きの取扱いについて」の、
  # 重症度、医療・看護必要度の A・C 項目に係るレセプト電算処理システム用コード一覧(別表1)と、
  # 「注射薬剤3種類以上の管理」で薬剤の種類数の対象から除くもの(別表2)の Excel を、
  # master_nursing_acuity_codes へ取り込む。評価票の版は 3 つ(別紙7 一般病棟用 / 別紙17 特定集中治療室用 /
  # 別紙18 ハイケアユニット用)。どのファイルかは先頭シートの表題で見分け、その版・種類(form, kind)だけを
  # 全件洗い替えする。新旧対照・見え消しのシートは読まない(先頭シートだけ)。
  #
  # 別表1 の先頭シート: 見出し行(「レセプト電算処理システム用コード」の列を持つ行)の次から、A 列 区分(Ａ/Ｃ)、
  # B 列 項目番号、C 列 項目名、D 列 コード、E 列 名称、F 列「※」(一般病棟用だけ。必要度Ⅰだけで用いる)。
  # 結合セルの続きは A〜C 列が空なので、直前の行の値を引き継ぐ。注射薬剤3種類以上の管理(一般 A3・HCU A4)は
  # コードではなく規則の行(「別紙７別表２の薬剤を除く、注射薬剤の種類数」)なので取り込まない。
  # 別表2 の先頭シート: 見出し行の次から A 列 コード、B 列 名称。
  class NursingAcuityCodeImporter
    CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫".chars.freeze
    FORM_TITLES = {
      "一般病棟用" => "general",
      "特定集中治療室用" => "icu",
      "ハイケアユニット用" => "hcu"
    }.freeze
    CODE_HEADER = "レセプト電算処理システム用コード".freeze

    Result = Struct.new(:imported_count, :skipped_count, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      form, kind, rows, skipped = ExcelSource.open(file) do |workbook|
        sheet = workbook.sheet(0)
        title = ExcelSource.normalize_label(ExcelSource.cell_string(sheet, 1, 1))
        form = FORM_TITLES.find { |name, _| title.include?(name) }&.last
        if form && title.include?("別表1")
          [form, "item", *item_rows(sheet, form)]
        elsif form && title.include?("別表2")
          [form, "a3_exclusion", *exclusion_rows(sheet)]
        else
          raise ImportError, "看護必要度の別表1(コード一覧)か別表2(注射薬剤の種類数から除く薬剤)の Excel(別紙7・17・18)を選んでください"
        end
      end
      raise ImportError, "コードが 1 件も読み取れませんでした" if rows.empty?

      ActiveRecord::Base.transaction do
        Master::NursingAcuityCode.where(form: form, kind: kind).delete_all
        Master::NursingAcuityCode.insert_all!(
          rows.map { |row| row.merge(form: form, kind: kind, created_at: now, updated_at: now) }
        )
      end

      Result.new(imported_count: rows.size, skipped_count: skipped)
    end

    private

    attr_reader :file

    def now
      @now ||= Time.current
    end

    def first_data_row(sheet)
      header = ExcelSource.find_header_row(sheet, [CODE_HEADER])
      raise ImportError, "見出し行(#{CODE_HEADER})が見つかりません" if header.nil?

      header + 1
    end

    def item_rows(sheet, form)
      rows = []
      skipped = 0
      group = number = label = nil
      (first_data_row(sheet)..sheet.last_row.to_i).each do |row|
        group = ExcelSource.cell_string(sheet, row, 1) || group
        number = ExcelSource.cell_string(sheet, row, 2) || number
        label = ExcelSource.cell_string(sheet, row, 3) || label
        code = ExcelSource.cell_string(sheet, row, 4)
        next if code.blank?
        # 注射薬剤3種類以上の管理は規則の行(コードの欄に「…注射薬剤の種類数」)なので取り込まない。
        next if code.include?("種類数")
        next skipped += 1 unless code.match?(/\A\d{9}\z/)

        item_code = item_code_of(group, number, label, form)
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
      (first_data_row(sheet)..sheet.last_row.to_i).each do |row|
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
    # 一般病棟用の A6 だけは小項目ごとに点数が違うので小項目まで持つ(C21 の①〜③は点数が同じなので項目でまとめる)。
    def item_code_of(group, number, label, form)
      letter = group.to_s.unicode_normalize(:nfkc).strip
      digits = number.to_s.unicode_normalize(:nfkc).strip
      return nil unless %w[A C].include?(letter) && digits.match?(/\A\d+\z/)

      if form == "general" && letter == "A" && digits == "6"
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
