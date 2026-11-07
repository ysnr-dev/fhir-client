module Master
  # 留置物(ライン・ドレーン・カテーテル)の種別マスタ(docs/line-drain-design.md §3)。
  # kind は集計の系統(中心静脈 / 尿路 / 気道など)、warn_days は留置日数を赤く出す既定値。
  class LineDrainType < ApplicationRecord
    self.table_name = "master_line_drain_types"

    KINDS = %w[vascular-central vascular-peripheral arterial urinary airway gi drain other].freeze

    validates :code, presence: true, uniqueness: true, format: { with: /\A[a-z0-9][a-z0-9-]*\z/ }
    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
    validates :warn_days, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  end
end
