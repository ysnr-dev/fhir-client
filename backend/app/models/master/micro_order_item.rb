module Master
  # 細菌検査オーダーの検査項目(塗抹・鏡検 / 培養・同定 / 薬剤感受性 など)。
  # seed で初期値を投入し、以後は画面でメンテする施設マスタ。
  # 廃止は削除ではなく有効終了日(valid_to)で行い、過去オーダーの表示を保つ。
  class MicroOrderItem < ApplicationRecord
    self.table_name = "master_micro_order_items"

    validates :item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validate :valid_period_is_ordered

    before_save :set_search_columns

    # 今日オーダーできる項目(有効期間内)。
    scope :active, -> {
      where("valid_from IS NULL OR valid_from <= ?", Date.current)
        .where("valid_to IS NULL OR valid_to >= ?", Date.current)
    }

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は有効開始日以降の日付にしてください")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize([name, short_name].compact.join)
    end
  end
end
