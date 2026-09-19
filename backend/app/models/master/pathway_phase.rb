module Master
  # パスのフェーズ(連続する病日のまとまり)。患者への適用はフェーズ単位で進め、フェーズの
  # 終わりで分岐(PathwayPhaseBranch)から次を選ぶ。表示順の先頭が開始フェーズ。
  # phase_key は適用後まで持ち越す識別子(病日の CarePlan に焼く)。
  class PathwayPhase < ApplicationRecord
    self.table_name = "master_pathway_phases"

    validates :pathway_code, presence: true
    validates :phase_key, presence: true, format: { with: PathwayOatUnit::UUID_FORMAT }
    # 置換のときの重なりはコントローラが配列の中で見る(PathwaysController#replace_children)。
    validates :phase_key, uniqueness: { scope: :pathway_code, message: "が重複しています" }, on: :create

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }
  end
end
