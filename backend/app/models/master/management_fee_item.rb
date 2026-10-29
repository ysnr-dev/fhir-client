module Master
  # 指導・管理料の項目(docs/medical-management-order-design.md §2)。
  # 処置項目と違いセット・データセット・予約を持たないので OrderItemModel は使わない。
  class ManagementFeeItem < ApplicationRecord
    self.table_name = "master_management_fee_items"

    RECEIPT_CODE = /\A\d{9}\z/

    validates :item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :receipt_code, format: { with: RECEIPT_CODE, message: "は 9 桁の数字で入力してください" }
    validates :monthly_limit, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
    validate :addition_codes_must_be_receipt_codes
    validate :must_apply_to_some_setting

    scope :active, -> { where(active: true) }

    before_validation :normalize_addition_codes
    before_save :set_search_columns

    private

    def normalize_addition_codes
      self.addition_codes = Array(addition_codes).map { |c| c.to_s.strip }.compact_blank.uniq
    end

    def addition_codes_must_be_receipt_codes
      return if addition_codes.all? { |c| c.match?(RECEIPT_CODE) }

      errors.add(:addition_codes, "は 9 桁の数字で入力してください")
    end

    def must_apply_to_some_setting
      errors.add(:base, "入院・外来のどちらかで算定できるようにしてください") unless inpatient || outpatient
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
