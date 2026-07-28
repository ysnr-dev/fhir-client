module Master
  # ICD10対応標準病名マスター(MEDIS)の修飾語テーブル。
  class Modifier < ApplicationRecord
    self.table_name = "master_modifiers"

    validates :management_number, presence: true, uniqueness: true
    validates :name, presence: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
