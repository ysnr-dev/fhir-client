module Master
  # レジメンで想定する副作用。用語は CTCAE を自由記述、grade は 1〜5。
  class RegimenAdverseEvent < ApplicationRecord
    self.table_name = "master_regimen_adverse_events"

    validates :regimen_code, presence: true
    validates :term, presence: true
    validates :grade, inclusion: { in: 1..5 }, allow_nil: true

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }
  end
end
