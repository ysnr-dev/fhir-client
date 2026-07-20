module Master
  class MedicineUsage < ApplicationRecord
    self.table_name = "master_medicine_usages"

    validates :usage_code, presence: true, uniqueness: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(usage_name)
    end
  end
end
