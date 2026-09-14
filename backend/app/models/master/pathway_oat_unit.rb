module Master
  # OAT ユニット(アウトカム + 観察項目 + タスク)。unit_key は適用後まで持ち越す識別子。
  class PathwayOatUnit < ApplicationRecord
    self.table_name = "master_pathway_oat_units"

    # アウトカム大分類(BOM): G 患者目標 / H 患者状態
    CATEGORIES = %w[G H].freeze
    # コード体系: BOM(Basic Outcome Master) / 施設ローカル
    CODE_SYSTEMS = %w[bom local].freeze
    UUID_FORMAT = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i

    has_many :assessments, -> { in_display_order },
             class_name: "Master::PathwayAssessment", foreign_key: :unit_id
    has_many :tasks, -> { in_display_order },
             class_name: "Master::PathwayTask", foreign_key: :unit_id

    validates :pathway_code, :event_id, presence: true
    # 同じ unit_key を別の病日に置いたものが日をまたぐアウトカム(続き)。重なってはいけないのは同じ病日の中だけ。
    validates :unit_key, presence: true, format: { with: UUID_FORMAT },
                         uniqueness: { scope: :event_id, message: "が同じ病日の中で重複しています" }
    validates :name, presence: true
    validates :category, inclusion: { in: CATEGORIES }, allow_blank: true
    validates :code_system, inclusion: { in: CODE_SYSTEMS }, allow_blank: true

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }
  end
end
