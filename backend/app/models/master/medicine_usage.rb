module Master
  class MedicineUsage < ApplicationRecord
    self.table_name = "master_medicine_usages"

    validates :usage_code, presence: true, uniqueness: true
  end
end
