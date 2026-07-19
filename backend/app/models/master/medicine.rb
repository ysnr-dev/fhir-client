module Master
  class Medicine < ApplicationRecord
    self.table_name = "master_medicines"

    validates :medicine_code, presence: true, uniqueness: true
  end
end
