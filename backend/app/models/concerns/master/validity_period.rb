module Master
  # 有効期間(valid_from / valid_to)を持つマスタの「その日に使えるもの」。
  # 開始・終了とも空なら無期限。日付を省くと施設の今日(FacilityClock)。
  module ValidityPeriod
    extend ActiveSupport::Concern

    included do
      scope :active_on, lambda { |date = FacilityClock.today|
        where("valid_from IS NULL OR valid_from <= ?", date)
          .where("valid_to IS NULL OR valid_to >= ?", date)
      }
    end
  end
end
