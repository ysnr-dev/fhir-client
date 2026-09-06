module Master
  # レジメンの投与ステップ(注射の RP = 混注に相当)。順序・相対日・手技・経路・
  # 点滴時間・器材はここが持ち、薬剤は RegimenDrug としてぶら下がる。
  class RegimenStep < ApplicationRecord
    self.table_name = "master_regimen_steps"

    # 点滴 / ワンショット / 内服
    USAGE_TYPES = %w[drip one-shot oral].freeze

    has_many :drugs, -> { in_display_order },
             class_name: "Master::RegimenDrug", foreign_key: :step_id

    validates :regimen_code, presence: true
    validates :usage_type, inclusion: { in: USAGE_TYPES }
    validates :infusion_minutes, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
    validates :rate, numericality: { greater_than: 0 }, allow_nil: true
    validates :dose_days, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
    validate :days_are_positive_integers

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }

    def oral?
      usage_type == "oral"
    end

    private

    # 投与日は 1 以上の整数の並びで、同じ日を 2 回書けない。
    def days_are_positive_integers
      unless days.is_a?(Array)
        errors.add(:days, "は投与日の配列で指定してください")
        return
      end
      if days.empty?
        errors.add(:days, "を 1 日以上指定してください")
        return
      end
      unless days.all? { |d| d.is_a?(Integer) && d >= 1 }
        errors.add(:days, "は 1 以上の整数で指定してください")
        return
      end
      errors.add(:days, "に同じ日が重複しています") if days.uniq.size != days.size
    end
  end
end
