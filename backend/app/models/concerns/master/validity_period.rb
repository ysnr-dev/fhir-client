module Master
  # 有効期間(valid_from / valid_to)を持つマスタ。
  # - active_on: 「その日に使えるもの」。開始・終了とも空なら無期限。日付を省くと施設の今日(FacilityClock)。
  # - valid_period_is_ordered: 終了日が開始日より前でないことの検証。モデル側で validate に載せる
  #   (登録順をモデルごとに決めるため)。開始日の呼び名が違うマスタは valid_period_start_label を上書きする。
  module ValidityPeriod
    extend ActiveSupport::Concern

    included do
      scope :active_on, lambda { |date = FacilityClock.today|
        where("valid_from IS NULL OR valid_from <= ?", date)
          .where("valid_to IS NULL OR valid_to >= ?", date)
      }
    end

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は#{valid_period_start_label}以降の日付にしてください")
    end

    def valid_period_start_label
      "有効開始日"
    end
  end
end
