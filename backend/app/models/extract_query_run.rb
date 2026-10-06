# データ抽出の実行の記録 1 件(定点観測の推移。docs/data-extract-design.md)。
# 該当人数と条件ごとの人数だけを持ち、患者の一覧は持たない(いつ・誰が見ても同じ条件で
# 引き直せるうえ、患者の情報を backend に溜めないため)。
class ExtractQueryRun < ApplicationRecord
  belongs_to :extract_query

  LEAF_COUNTS_SHAPE = { map: { integer: { min: 0, unit: "人" } }, keys: :any }.freeze

  validates :ran_at, presence: true
  validates :patient_count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :leaf_counts_shape

  private

  def leaf_counts_shape
    JsonShape.errors(LEAF_COUNTS_SHAPE, leaf_counts, "leaf_counts").each { |m| errors.add(:leaf_counts, m) }
  end
end
