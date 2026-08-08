module Master
  class LabItem < ApplicationRecord
    self.table_name = "master_lab_items"

    validates :jlac11_code, presence: true, uniqueness: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(fhir_item_name)
      self.search_abbreviation = SearchNormalizer.normalize(abbreviation)
      self.search_major_item = SearchNormalizer.normalize(major_item)
    end
  end
end
