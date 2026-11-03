module Master
  # BOM(Basic Outcome Master®)のアウトカム。大分類 → 中分類 → アウトカムコードの階層を 1 行に持つ。
  # 配布ファイルは日本クリニカルパス学会の知財で同梱しない。取込(import)と検索(index)だけ。
  class BomOutcome < ApplicationRecord
    self.table_name = "master_bom_outcomes"

    validates :outcome_code, presence: true, uniqueness: true
    validates :outcome_name, presence: true

    before_save :fill_search_columns

    private

    def fill_search_columns
      self.search_name = SearchNormalizer.normalize(outcome_name)
    end
  end
end
