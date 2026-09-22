module Master
  # 放射線治療の休止・中止理由のマスタ(docs/radiotherapy-order-design.md §3)。
  class RadiotherapyStopReason < ApplicationRecord
    self.table_name = "master_radiotherapy_stop_reasons"

    KINDS = %w[suspend terminate both].freeze

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
  end
end
