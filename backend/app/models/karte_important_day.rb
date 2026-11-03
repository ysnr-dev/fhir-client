# カルテの重要日(docs/features/karte.md)。患者と診療日につき 1 つで、利用者の間で共有する。
# 重要度は 3 段階(high / medium / low)。comment は日付の横に出す理由(1 行)。
class KarteImportantDay < ApplicationRecord
  SEVERITIES = %w[high medium low].freeze
  MAX_COMMENT_LENGTH = 200

  validates :patient_id, presence: true
  validates :day, presence: true, uniqueness: { scope: :patient_id }
  validates :severity, inclusion: { in: SEVERITIES }
  validates :comment, length: { maximum: MAX_COMMENT_LENGTH }
end
