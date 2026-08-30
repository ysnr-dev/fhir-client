module Master
  # 食事オーダー項目。食種(kind = diet)・主食(kind = staple)・副食形態
  # (kind = side_dish_form)を 1 テーブルに入れる。列構成が同じで、オーダー側は
  # FHIR の CodeSystem URI(meal-type / meal-staple-food / meal-side-dish-form)で
  # 既に区別しているため、テーブルを分ける利点が無い。
  #
  # 食止めは食種の 1 レコード(is_fasting = true)として持つ。SS-MIX2 の給食オーダが
  # 食止めを食種コード(NPO)で表すのに合わせたもので、オーダー側に「食止めか」の
  # 印は持たない。
  #
  # 副食形態はきざみ・ミキサー・一口大 など「主食以外をどう調理して出すか」。
  # 施設ごとに呼び名も刻みの段階数も違うのでマスタにしてある。
  class MealItem < ApplicationRecord
    self.table_name = "master_meal_items"

    KINDS = %w[diet staple side_dish_form].freeze

    validates :item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
    validate :valid_period_is_ordered
    validate :fasting_is_diet
    validate :category_is_diet

    before_save :set_search_columns

    def diet?
      kind == "diet"
    end

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は有効開始日以降の日付にしてください")
    end

    # 食止めは「その日は食事を出さない」食種であって、主食の一種ではない。
    # 画面では食種のときしかチェックを出さないが、API から入る矛盾もここで落とす。
    def fasting_is_diet
      return unless is_fasting && !diet?

      errors.add(:base, "食止めにできるのは食種だけです")
    end

    # 種別(master_meal_categories)を付けるのは食種だけ。主食を分類する運用が無く、
    # 種別マスタに食種用と主食用が混ざらないようにする。画面でも食種のときしか
    # 欄を出さないが、API から入る矛盾もここで落とす。
    def category_is_diet
      return if category_code.blank? || diet?

      errors.add(:base, "種別を設定できるのは食種だけです")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
