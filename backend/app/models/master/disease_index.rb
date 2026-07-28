module Master
  # ICD10対応標準病名マスター(MEDIS)の索引テーブル。
  # 索引用語から病名表記(disease_modifier_category=1)または
  # 修飾語表記(=2)の交換用コード(target_code)を引くための検索用テーブル。
  class DiseaseIndex < ApplicationRecord
    self.table_name = "master_disease_indexes"

    validates :term, presence: true
    validates :target_code, presence: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_term = SearchNormalizer.normalize(term)
    end
  end
end
