module Master
  # 検体検査の結果項目の基準値と、パニック値(緊急異常値)のしきい値。
  # どちらも「項目 × 性別 × 年齢帯」で決まる判定の境界なので同じ行に持つ。
  # 結果項目とはコードで緩く紐づく。適用行の選び方は frontend(labResultHelpers)が決める:
  # 性別が一致(または共通)し、採取日の満年齢が age_from〜age_to に入る行のうち表示順の先頭。
  class LabReferenceRange < ApplicationRecord
    self.table_name = "master_lab_reference_ranges"

    SEXES = %w[male female].freeze

    validates :result_item_code, presence: true
    validates :sex, inclusion: { in: SEXES }, allow_blank: true
    validate :has_a_limit
    validate :limits_are_ordered
    validate :panic_limits_are_ordered
    validate :ages_are_ordered

    private

    def has_a_limit
      return if lower_limit.present? || upper_limit.present? ||
                panic_lower.present? || panic_upper.present?

      errors.add(:lower_limit, "・上限・パニック値のいずれかを入力してください")
    end

    def limits_are_ordered
      return if lower_limit.blank? || upper_limit.blank? || lower_limit <= upper_limit

      errors.add(:upper_limit, "は下限以上の値にしてください")
    end

    # パニック値は基準値の外側にある(下は基準下限以下・上は基準上限以上)。
    # 内側に入っていると、基準範囲内なのにパニック値になる行ができてしまう。
    def panic_limits_are_ordered
      if panic_lower.present? && panic_upper.present? && panic_lower > panic_upper
        errors.add(:panic_upper, "はパニック値(下)以上の値にしてください")
      end
      if panic_lower.present? && lower_limit.present? && panic_lower > lower_limit
        errors.add(:panic_lower, "は基準値の下限以下にしてください")
      end
      return unless panic_upper.present? && upper_limit.present? && panic_upper < upper_limit

      errors.add(:panic_upper, "は基準値の上限以上にしてください")
    end

    def ages_are_ordered
      return if age_from.blank? || age_to.blank? || age_from <= age_to

      errors.add(:age_to, "は開始年齢以上にしてください")
    end
  end
end
