require "cgi"
require "roo"

module MasterImport
  # CTCAE v5.0 日本語訳 JCOG 版の配布 Excel(CTCAEv5J_YYYYMMDD_vXX_X.xlsx)から
  # master_ctcae_terms へ全件洗い替えで取り込む。
  #
  # 配布ファイルは 1 シート(Sheet1)で、SOC の見出し行と用語行が混在する。
  # 見出し行は B 列だけに「血液およびリンパ系障害 Blood and lymphatic system disorders」の
  # ような文字列が入り、用語行は C〜T 列に SOC・用語・Grade 定義が並ぶ。
  # 見出し行の情報は用語行にも入っているので読み飛ばす。
  #
  # 配布ファイルはリポジトリに同梱しない(JCOG との利用条件。§7.6 F)。
  class CtcaeTermImporter
    # 列(1 始まり)。A はソート用 ID、B は MedDRA コード。
    COLUMNS = {
      display_order: 1,
      meddra_code: 2,
      soc_en: 3,
      soc_ja: 4,
      term_en: 5,
      term_ja: 6,
      grade1_en: 7,
      grade1_ja: 8,
      grade2_en: 9,
      grade2_ja: 10,
      grade3_en: 11,
      grade3_ja: 12,
      grade4_en: 13,
      grade4_ja: 14,
      grade5_en: 15,
      grade5_ja: 16,
      definition_en: 17,
      definition_ja: 18,
      navigational_note_en: 19,
      navigational_note_ja: 20
    }.freeze

    # 配布ファイルは「該当なし」をハイフンで表す。空にして持つ。
    BLANK_MARKS = ["-", "‐", "―", "ー", "－"].freeze

    # 一部のセルは上付き文字を表すために HTML(<html>…<sup>3</sup>…</html>)で入っている。
    # 単位の意味が変わるので、上付き数字は Unicode に置き換えてから他のタグを落とす
    # (「mm<sup>3</sup>」→「mm³」。タグを単純に消すと「mm3」になり読み違えやすい)。
    SUPERSCRIPTS = {
      "0" => "⁰", "1" => "¹", "2" => "²", "3" => "³", "4" => "⁴",
      "5" => "⁵", "6" => "⁶", "7" => "⁷", "8" => "⁸", "9" => "⁹"
    }.freeze

    Result = Struct.new(:imported_count, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      rows = ExcelSource.open(file) { |workbook| build_rows(workbook.sheet(0)) }
      raise ImportError, "CTCAE の用語が 1 件も読み取れませんでした" if rows.empty?

      ActiveRecord::Base.transaction do
        Master::CtcaeTerm.delete_all
        rows.each { |attrs| Master::CtcaeTerm.create!(attrs) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def build_rows(sheet)
      seen = {}
      (2..sheet.last_row.to_i).each do |row|
        attrs = COLUMNS.transform_values { |column| cell(sheet, row, column) }
        # SOC の見出し行(B 列だけ)と空行を飛ばす。
        next if attrs[:meddra_code].blank? || attrs[:term_ja].blank?

        attrs[:display_order] = attrs[:display_order].to_s[/\d+/]&.to_i
        # 同じ MedDRA コードが複数行に出ることは無いが、あれば先に出た方を残す。
        seen[attrs[:meddra_code]] ||= attrs
      end
      seen.values
    end

    def cell(sheet, row, column)
      value = ExcelSource.cell_string(sheet, row, column)
      return nil if value.blank? || BLANK_MARKS.include?(value)

      strip_markup(value).presence
    end

    def strip_markup(text)
      return text unless text.include?("<")

      without_sup = text.gsub(%r{<sup>(\d+)</sup>}) do
        ::Regexp.last_match(1).chars.map { |c| SUPERSCRIPTS[c] }.join
      end
      CGI.unescapeHTML(without_sup.gsub(/<[^>]+>/, "")).strip
    end
  end
end
