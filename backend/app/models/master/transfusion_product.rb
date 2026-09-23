module Master
  # 輸血製剤マスタ。食事オーダー項目(MealItem)と同じ素朴な編集型マスタで、
  # セット構成も実施入力データセットも持たない。
  class TransfusionProduct < ApplicationRecord
    self.table_name = "master_transfusion_products"

    # rbc = 赤血球 / ffp = 血漿 / plt = 血小板 / auto = 自己血 / other = その他
    CATEGORIES = %w[rbc ffp plt auto other].freeze

    validates :item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :category, inclusion: { in: CATEGORIES }
    validates :unit_label, presence: true
    validates :default_units,
              numericality: { only_integer: true, greater_than: 0 },
              allow_nil: true
    # 医事会計へ送るレセプト電算の医薬品コード。血液製剤は医薬品として算定する。
    # 自己血のように薬価収載が無いものは空(製剤は送らず、送れない項目として報告する)。
    validates :medicine_code, format: { with: /\A\d{9}\z/, message: "は 9 桁の数字で指定してください" },
                              allow_blank: true
    validate :valid_period_is_ordered

    before_save :set_search_columns

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は有効開始日以降の日付にしてください")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
