# Web 問診の回答 1 件(質問票 1 本ぶん)。中身は QuestionnaireResponse.item の配列をそのまま持つ。
# pending: 職員の取込待ち / imported: 上流の QuestionnaireResponse にした / discarded: 取り込まずに捨てた
class IntakeResponse < ApplicationRecord
  STATUSES = %w[pending imported discarded].freeze

  belongs_to :link, class_name: "IntakeLink", foreign_key: :intake_link_id, inverse_of: :responses

  validates :questionnaire_url, presence: true
  validates :status, inclusion: { in: STATUSES }

  scope :pending, -> { where(status: "pending") }
end
