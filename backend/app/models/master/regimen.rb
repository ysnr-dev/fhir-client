module Master
  # 化学療法レジメンマスタ(docs/chemo-regimen-design.md)。
  #
  # 審査委員会で承認する施設共通の参照表なので、オーダーセットのような持ち主の
  # 階層は持たず、診療科・適応疾患は分類属性として持つ。中身(適応疾患・投与
  # ステップ・薬剤・検査基準・副作用)は regimen_code で結ぶ子テーブルに置き、
  # 外部キーは張らない(他マスタと同じ。整合性はコントローラの transaction で守る)。
  class Regimen < ApplicationRecord
    self.table_name = "master_regimens"

    # 治療目的: 術前補助 / 術後補助 / 根治 / 緩和 / その他
    PURPOSES = %w[neoadjuvant adjuvant curative palliative other].freeze
    # 実施区分: 外来 / 入院 / 両方
    SETTINGS = %w[outpatient inpatient both].freeze
    # 制吐リスク分類(高度 / 中等度 / 軽度 / 最小度)
    EMETIC_RISKS = %w[high moderate low minimal].freeze
    # 下書き / 承認済 / 廃止
    STATUSES = %w[draft approved retired].freeze

    has_many :indications, -> { in_display_order },
             class_name: "Master::RegimenIndication", primary_key: :regimen_code, foreign_key: :regimen_code
    has_many :steps, -> { in_display_order },
             class_name: "Master::RegimenStep", primary_key: :regimen_code, foreign_key: :regimen_code
    has_many :drugs, class_name: "Master::RegimenDrug", primary_key: :regimen_code, foreign_key: :regimen_code
    has_many :lab_criteria, -> { in_display_order },
             class_name: "Master::RegimenLabCriterion", primary_key: :regimen_code, foreign_key: :regimen_code
    has_many :adverse_events, -> { in_display_order },
             class_name: "Master::RegimenAdverseEvent", primary_key: :regimen_code, foreign_key: :regimen_code

    validates :regimen_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :purpose, inclusion: { in: PURPOSES }, allow_blank: true
    validates :setting, inclusion: { in: SETTINGS }, allow_blank: true
    validates :emetic_risk, inclusion: { in: EMETIC_RISKS }, allow_blank: true
    validates :status, inclusion: { in: STATUSES }
    validates :treatment_days, :rest_days,
              numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
    validates :planned_cycles, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
    validate :valid_period_is_ordered

    # 今日オーダーに使えるレジメン(有効期間内)。
    scope :active_on, lambda { |date = Date.current|
      where("valid_from IS NULL OR valid_from <= ?", date)
        .where("valid_to IS NULL OR valid_to >= ?", date)
    }

    before_save :set_search_columns

    # 1 クールの長さ(日) = 投与期間 + 休薬期間。保存せず導出する。
    def cycle_days
      treatment_days.to_i + rest_days.to_i
    end

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
