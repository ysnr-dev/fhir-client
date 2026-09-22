module Master
  # 照射技法のマスタ(docs/radiotherapy-order-design.md §3)。
  class RadiotherapyTechnique < ApplicationRecord
    self.table_name = "master_radiotherapy_techniques"

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validate :modality_codes_are_strings

    private

    def modality_codes_are_strings
      return if modality_codes.is_a?(Array) && modality_codes.all?(String)

      errors.add(:modality_codes, "はモダリティのコードの配列で指定してください")
    end
  end
end
