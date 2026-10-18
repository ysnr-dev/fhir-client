# 警告(判断支援)の発火と無視の台帳(docs/advisory-design.md §3.2)。
# fired = フォームのセッション中に一度でも表示された、overridden = 理由を選んで登録した。
class AdvisoryEvent < ApplicationRecord
  OUTCOMES = %w[fired overridden].freeze
  SEVERITIES = %w[info warning block].freeze
  KEY_PATTERN = /\A[a-z][a-z-]*\z/

  validates :session_id, :advisory_key, :kind, :severity, :outcome, :context, :occurred_at, presence: true
  validates :outcome, inclusion: { in: OUTCOMES }
  validates :severity, inclusion: { in: SEVERITIES }
  validates :kind, :context, format: { with: KEY_PATTERN }
end
