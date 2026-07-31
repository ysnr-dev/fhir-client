module Master
  # J-FAGYアレルゲンコード表(JFAGYコード)のマスタテーブル。
  class JfagyAllergen < ApplicationRecord
    self.table_name = "master_jfagy_allergens"

    validates :jfagy_code, presence: true, uniqueness: true
    validates :name, presence: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
