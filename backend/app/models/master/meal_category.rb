module Master
  # 食種の種別(分類)。一般食・特別食(治療食)・その他 のように食種をまとめる。
  # 食事オーダー項目マスタからは master_meal_items.category_code でコード参照する
  # (FK は張らない)。手術の SurgeryCategory と違い階層は持たない。
  class MealCategory < ApplicationRecord
    self.table_name = "master_meal_categories"

    validates :category_code, presence: true, uniqueness: true
    validates :name, presence: true
    validate :valid_period_is_ordered

    # 今日使える分類(オーダー画面・項目マスタの選択肢に出す対象)。
    scope :active_on, lambda { |date = Date.current|
      where("valid_from IS NULL OR valid_from <= ?", date)
        .where("valid_to IS NULL OR valid_to >= ?", date)
    }

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
