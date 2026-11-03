module Master
  # BOM(Basic Outcome Master®)の観察項目。観察項目分類と、対応する MEDIS 看護観察の管理番号を持つ。
  # 配布ファイルは日本クリニカルパス学会の知財で同梱しない。取込(import)と検索(index)だけ。
  class BomAssessment < ApplicationRecord
    self.table_name = "master_bom_assessments"

    validates :assessment_code, presence: true, uniqueness: true
    validates :name, presence: true

    before_save :fill_search_columns

    private

    def fill_search_columns
      self.search_name = SearchNormalizer.normalize([name, name2].compact_blank.join(" "))
    end
  end
end
