module Master
  # 食種の種別(分類)。一般食・特別食(治療食)・その他 のように食種をまとめる。
  # 食事オーダー項目マスタからは master_meal_items.category_code でコード参照する
  # (FK は張らない)。手術の SurgeryCategory と違い階層は持たない。
  #
  # 名称は施設が自由に付けるので、それとは別に「給与形態」を固定コードで持つ
  # (nutrition_form)。オーダー画面が入力欄を切り替える判断軸で、名称の文字列を
  # 見て推測しなくて済むようにするためのもの。
  class MealCategory < ApplicationRecord
    self.table_name = "master_meal_categories"

    # 給与形態。参考仕様 §1 の分類に対応し、FHIR NutritionOrder の要素名に寄せてある。
    #   oral_diet       普通食・治療食(参考仕様 §2)。主食・副食形態を指示する
    #   enteral_formula 経管・経口食(§3)。濃厚流動食なので主食を持たない
    #   infant_formula  調乳食(§4)。同上
    # 「欠食」は食種の is_fasting が担当するので値に入れない(二重管理を避ける)。
    NUTRITION_FORMS = %w[oral_diet enteral_formula infant_formula].freeze

    validates :category_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :nutrition_form, inclusion: { in: NUTRITION_FORMS }
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
