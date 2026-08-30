module Master
  # 食種(食止めを含む)。一般食2000kcal・糖尿病食1600kcal・食止め など、オーダーが
  # code で指す「どの食事を出すか」の本体。主食・副食形態(MealItem)と違い、種別・
  # 食止め・主成分量・適応といった性質を持つので別テーブルにしてある
  # (docs/meal-order-design.md §3)。
  #
  # 食止めは食種の 1 レコード(is_fasting = true)として持つ。SS-MIX2 の給食オーダが
  # 食止めを食種コード(NPO)で表すのに合わせたもので、オーダー側に「食止めか」の
  # 印は持たない。
  #
  # 主成分量(energy_kcal ... salt_g)は 1 日あたりの標準値で、オーダーには写さない。
  # 食種の性質であってオーダーごとに変わらないため(§3.3)。
  class MealDiet < ApplicationRecord
    self.table_name = "master_meal_diets"

    NUTRIENT_COLUMNS = %w[energy_kcal protein_g fat_g carbohydrate_g water_ml salt_g].freeze

    validates :item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates(*NUTRIENT_COLUMNS, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true)
    validate :valid_period_is_ordered

    # 今日オーダーできる食種(有効期間内)。
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
