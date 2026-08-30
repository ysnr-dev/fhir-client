module Master
  # 食事オーダー項目。主食(kind = staple)・副食形態(kind = side_dish_form)を
  # 1 テーブルに入れる。どちらも「食種をどう出すか」を修飾するコードと名称のリストで、
  # 列構成が同じ。オーダー側は FHIR の CodeSystem URI(meal-staple-food /
  # meal-side-dish-form)で既に区別しているため、テーブルを分ける利点が無い。
  #
  # 食種は性質(種別・食止め・主成分量)を持つので別テーブル(MealDiet)。
  #
  # 副食形態はきざみ・ミキサー・一口大 など「主食以外をどう調理して出すか」。
  # 施設ごとに呼び名も刻みの段階数も違うのでマスタにしてある。
  class MealItem < ApplicationRecord
    self.table_name = "master_meal_items"

    KINDS = %w[staple side_dish_form].freeze

    validates :item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
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
