module Master
  # 照射モダリティのマスタ(docs/radiotherapy-order-design.md §3)。
  class RadiotherapyModality < ApplicationRecord
    self.table_name = "master_radiotherapy_modalities"

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :dose_unit, presence: true
  end
end
