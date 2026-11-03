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
    # 標準クリニカルパスコード: 医療機関コード(10)-分類(2)+連番(5)-派生(5)。連番・派生は英数字。
    STANDARD_PATH_CODE_FORMAT = /\A\d{10}-[0-9A-Za-z]{7}-[0-9A-Za-z]{5}\z/
    # 版(施設パス版・ひな型版)は X または X.Y。
    VERSION_FORMAT = /\A\d+(\.\d+)?\z/

    has_many :indications, -> { in_display_order },
             class_name: "Master::PathwayIndication", primary_key: :pathway_code, foreign_key: :pathway_code
    has_many :phases, -> { in_display_order },
             class_name: "Master::PathwayPhase", primary_key: :pathway_code, foreign_key: :pathway_code
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
    validates :standard_path_code, format: { with: STANDARD_PATH_CODE_FORMAT,
                                             message: "は 0000000000-0000001-00000 の形式で入力してください" },
                                   allow_blank: true
    validates :template_version, format: { with: VERSION_FORMAT, message: "は X または X.Y の形式で入力してください" },
                                 allow_blank: true
    validate :valid_period_is_ordered

    # 今日適用できるパス(有効期間内)。
    include Master::ValidityPeriod

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
      self.search_short_name = SearchNormalizer.normalize(short_name)
    end
  end
end
