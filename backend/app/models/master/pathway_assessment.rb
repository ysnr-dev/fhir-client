module Master
  # 観察項目。assessment_key は適用後まで持ち越す識別子。
  class PathwayAssessment < ApplicationRecord
    self.table_name = "master_pathway_assessments"

    validates :pathway_code, :unit_id, presence: true
    validates :assessment_key, presence: true, format: { with: PathwayOatUnit::UUID_FORMAT }
    # 置換のときの重なりはコントローラが配列の中で見る(PathwaysController#replace_children)。
    validates :assessment_key, uniqueness: { scope: :unit_id, message: "が同じ OAT ユニットの中で重複しています" },
                               on: :create
    validates :name, presence: true
    validates :code_system, inclusion: { in: PathwayOatUnit::CODE_SYSTEMS }, allow_blank: true
    validate :proper_criteria_consistent

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }

    private

    # 適正値の基準。下限 ≤ 上限、許容値は文字列の配列(空文字は含めない)。
    def proper_criteria_consistent
      if proper_low.present? && proper_high.present? && proper_low > proper_high
        errors.add(:proper_low, "は上限以下にしてください")
      end
      return if proper_values.nil?

      unless proper_values.is_a?(Array) && proper_values.all? { |v| v.is_a?(String) && v.present? }
        errors.add(:proper_values, "は文字列の配列で指定してください")
      end
    end
  end
end
