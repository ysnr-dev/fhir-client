module Master
  # 術式。医師が手術オーダー(申込)画面で選ぶ単位。
  # 処置の TreatmentItem との違いは、セット・レイアウト・実施入力データセット・
  # 予約枠の紐づけを持たず、代わりに申込フォームの初期値になる既定値列
  # (所要時間・到達法・体位・麻酔方法)を持つこと。
  class SurgeryItem < ApplicationRecord
    self.table_name = "master_surgery_items"

    validates :item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :default_duration_minutes, numericality: { only_integer: true, greater_than: 0 },
                                         allow_nil: true
    validate :valid_period_is_ordered

    before_save :set_search_columns

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は有効開始日以降の日付にしてください")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_short_name = SearchNormalizer.normalize(short_name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
