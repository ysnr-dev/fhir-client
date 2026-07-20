module Master
  class Medicine < ApplicationRecord
    self.table_name = "master_medicines"

    validates :medicine_code, presence: true, uniqueness: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
      self.search_generic = SearchNormalizer.normalize(generic_name_description)
    end
  end
end
