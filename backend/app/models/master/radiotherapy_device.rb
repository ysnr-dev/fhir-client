module Master
  # 放射線治療装置のマスタ(docs/radiotherapy-order-design.md §3)。
  class RadiotherapyDevice < ApplicationRecord
    self.table_name = "master_radiotherapy_devices"

    DEVICE_TYPES = %w[linac tomotherapy stereotactic particle brachytherapy other].freeze

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :device_type, inclusion: { in: DEVICE_TYPES }
    validate :modality_codes_are_strings

    private

    def modality_codes_are_strings
      return if modality_codes.is_a?(Array) && modality_codes.all?(String)

      errors.add(:modality_codes, "はモダリティのコードの配列で指定してください")
    end
  end
end
