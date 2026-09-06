module Master
  # レジメンの適応基準のうち検査結果値。検査項目は JLAC11 の分析物 5 桁で持つ。
  class RegimenLabCriterion < ApplicationRecord
    self.table_name = "master_regimen_lab_criteria"

    # 腎機能 / 肝機能 / 血液検査 / その他
    CATEGORIES = %w[renal hepatic blood other].freeze

    validates :regimen_code, presence: true
    validates :category, inclusion: { in: CATEGORIES }
    validates :item_name, presence: true
    validate :limits_are_ordered

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }

    private

    def limits_are_ordered
      return if lower_limit.blank? || upper_limit.blank? || lower_limit < upper_limit

      errors.add(:upper_limit, "は下限より大きくしてください")
    end
  end
end
