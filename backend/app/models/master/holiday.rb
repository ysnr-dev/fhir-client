module Master
  # 祝日・休診日。国民の祝日(national)は内閣府の CSV の取込で入れ替わり、
  # 施設の休診日(facility)は画面から登録する。1 日 1 行。
  class Holiday < ApplicationRecord
    self.table_name = "master_holidays"

    KINDS = %w[national facility].freeze

    validates :holiday_date, presence: true, uniqueness: true
    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
  end
end
