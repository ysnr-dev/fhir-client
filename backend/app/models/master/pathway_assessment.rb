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

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }
  end
end
