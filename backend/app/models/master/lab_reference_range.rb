module Master
  # 検体検査の結果項目の基準値(性別・年齢帯ごとの下限・上限)。
  # 結果項目とはコードで緩く紐づく。適用行の選び方は frontend(labResultHelpers)が決める:
  # 性別が一致(または共通)し、採取日の満年齢が age_from〜age_to に入る行のうち表示順の先頭。
  class LabReferenceRange < ApplicationRecord
    self.table_name = "master_lab_reference_ranges"

    SEXES = %w[male female].freeze

    validates :result_item_code, presence: true
    validates :sex, inclusion: { in: SEXES }, allow_blank: true
    validate :has_a_limit
    validate :limits_are_ordered
    validate :ages_are_ordered

    private

    def has_a_limit
      return if lower_limit.present? || upper_limit.present?

      errors.add(:lower_limit, "か上限のどちらかを入力してください")
    end

    def limits_are_ordered
      return if lower_limit.blank? || upper_limit.blank? || lower_limit <= upper_limit

      errors.add(:upper_limit, "は下限以上の値にしてください")
    end

    def ages_are_ordered
      return if age_from.blank? || age_to.blank? || age_from <= age_to

      errors.add(:age_to, "は開始年齢以上にしてください")
    end
  end
end
