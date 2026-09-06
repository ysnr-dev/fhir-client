module Master
  # CTCAE(有害事象共通用語規準)v5.0 日本語訳 JCOG 版の用語。
  #
  # 配布ファイル(Excel)は JCOG のサイトから施設が取得して取り込む。
  # **リポジトリには同梱しない**(非営利の臨床試験・治験なら許諾不要だが、
  # それ以外の利用は JCOG との契約が要る。MedDRA コードも MSSO の
  # ライセンス対象)。docs/chemo-regimen-design.md §7.6 F。
  class CtcaeTerm < ApplicationRecord
    self.table_name = "master_ctcae_terms"

    GRADES = (1..5).freeze

    validates :meddra_code, presence: true, uniqueness: true
    validates :term_ja, presence: true

    before_save :fill_search_columns

    # Grade 1〜5 のうち、定義がある(= その Grade が存在する)ものだけ。
    def available_grades
      GRADES.select { |g| public_send("grade#{g}_ja").present? }
    end

    private

    def fill_search_columns
      self.search_term = SearchNormalizer.normalize(term_ja)
      self.search_soc = SearchNormalizer.normalize(soc_ja)
    end
  end
end
