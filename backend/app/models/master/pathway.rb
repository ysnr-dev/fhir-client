module Master
  # クリニカルパス(施設パス)定義マスタ(docs/clinical-pathway-design.md)。
  #
  # ePath の施設パス(PlanDefinition EP02)に対応する。レジメンと同じ承認制の施設共通
  # マスタで、診療科・対象病名は分類属性として持つ。中身(病日・OAT ユニット・観察項目・
  # タスク)は pathway_code で結ぶ子テーブルに置き、外部キーは張らない。
  class Pathway < ApplicationRecord
    self.table_name = "master_pathways"

    # 下書き / 承認済 / 廃止
    STATUSES = %w[draft approved retired].freeze
    # 入院 / 外来
    SETTINGS = %w[inpatient outpatient].freeze

    has_many :indications, -> { in_display_order },
             class_name: "Master::PathwayIndication", primary_key: :pathway_code, foreign_key: :pathway_code
    has_many :events, -> { in_day_order },
             class_name: "Master::PathwayEvent", primary_key: :pathway_code, foreign_key: :pathway_code
    has_many :oat_units, class_name: "Master::PathwayOatUnit", primary_key: :pathway_code, foreign_key: :pathway_code
    has_many :assessments, class_name: "Master::PathwayAssessment", primary_key: :pathway_code, foreign_key: :pathway_code
    has_many :tasks, class_name: "Master::PathwayTask", primary_key: :pathway_code, foreign_key: :pathway_code

    validates :pathway_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :status, inclusion: { in: STATUSES }
    validates :setting, inclusion: { in: SETTINGS }
    validates :scheduled_days, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
    validate :valid_period_is_ordered

    # 今日適用できるパス(有効期間内)。
    scope :active_on, lambda { |date = Date.current|
      where("valid_from IS NULL OR valid_from <= ?", date)
        .where("valid_to IS NULL OR valid_to >= ?", date)
    }

    before_save :set_search_columns

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は有効開始日以降の日付にしてください")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
      self.search_short_name = SearchNormalizer.normalize(short_name)
    end
  end
end
