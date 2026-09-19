module Master
  # フェーズの終わりで選べる次の候補。to_phase_key が空の行は「ここでパスを終了」。
  # 候補の先頭が標準の経路(予定日数の検証はこの経路で見る)。criteria は選ぶときの目安。
  class PathwayPhaseBranch < ApplicationRecord
    self.table_name = "master_pathway_phase_branches"

    validates :pathway_code, :from_phase_key, presence: true

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }
  end
end
