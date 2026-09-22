module Master
  # 照射技法のマスタ(docs/radiotherapy-order-design.md §3)。
  class RadiotherapyTechnique < ApplicationRecord
    self.table_name = "master_radiotherapy_techniques"

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validate :modality_codes_are_strings
    # 医事会計へ送るレセプト電算コード(docs/receipt-billing-design.md §5)。体外照射は
    # 同じ日の 1 回目と 2 回目で別のコード、放射線治療管理料はコースの初回だけ。
    validates :receipt_code, :receipt_code_second, :management_receipt_code,
              format: { with: /\A\d{9}\z/, message: "は 9 桁の数字で指定してください" }, allow_blank: true

    private

    def modality_codes_are_strings
      return if modality_codes.is_a?(Array) && modality_codes.all?(String)

      errors.add(:modality_codes, "はモダリティのコードの配列で指定してください")
    end
  end
end
