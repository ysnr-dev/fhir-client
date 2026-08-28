module Master
  # 手術室のブロックスケジュール(曜日ごとの科割り当て)。
  #
  # 手術室カレンダーの背景と、申込・日程確定での「この時間帯は◯◯科の割当です」
  # 警告に使う。割当外でも登録は止めない(docs/surgery-calendar-design.md)。
  #
  # 検索用の search_* 列は持たない。名称で引くマスタではなく、手術室と曜日で
  # 全件を読み出して使うため。
  class SurgeryRoomBlock < ApplicationRecord
    self.table_name = "master_surgery_room_blocks"

    TIME_FORMAT = /\A([01][0-9]|2[0-3]):[0-5][0-9]\z/

    validates :location_id, presence: true
    validates :weekday, presence: true, inclusion: { in: 0..6 }
    validates :start_time, presence: true, format: { with: TIME_FORMAT, message: "は HH:MM 形式で入力してください" }
    validates :end_time, presence: true, format: { with: TIME_FORMAT, message: "は HH:MM 形式で入力してください" }
    validates :department_code, presence: true
    validate :time_range_is_ordered
    validate :valid_period_is_ordered
    validate :does_not_overlap_same_room_weekday

    # 今日使える割り当て(カレンダー・警告に出す対象)。
    scope :active_on, lambda { |date = Date.current|
      where("valid_from IS NULL OR valid_from <= ?", date)
        .where("valid_to IS NULL OR valid_to >= ?", date)
    }

    private

    def time_range_is_ordered
      return if start_time.blank? || end_time.blank?
      return unless TIME_FORMAT.match?(start_time) && TIME_FORMAT.match?(end_time)
      return if start_time < end_time

      errors.add(:end_time, "は開始時刻より後の時刻にしてください")
    end

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は有効開始日以降の日付にしてください")
    end

    # 同じ手術室・同じ曜日で時間帯が重なる割り当ては入力ミス。1 つの時間帯を
    # 2 つの科に割り当てても、警告のどちらを出せばよいか決められない。
    # 有効期間が重ならないもの(年度で入れ替える運用)は重複と見なさない。
    def does_not_overlap_same_room_weekday
      return if location_id.blank? || weekday.blank? || start_time.blank? || end_time.blank?

      siblings = self.class.where(location_id: location_id, weekday: weekday)
      siblings = siblings.where.not(id: id) if persisted?

      return unless siblings.any? { |other| time_overlaps?(other) && period_overlaps?(other) }

      # 特定の列のせいではないので :base に付ける(属性名が前置されない)。
      errors.add(:base, "同じ手術室・曜日の別の割り当てと時間帯が重なっています")
    end

    def time_overlaps?(other)
      start_time < other.end_time && other.start_time < end_time
    end

    def period_overlaps?(other)
      (valid_to.nil? || other.valid_from.nil? || valid_to >= other.valid_from) &&
        (other.valid_to.nil? || valid_from.nil? || other.valid_to >= valid_from)
    end
  end
end
