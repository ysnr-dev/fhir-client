module Master
  # パスの病日・イベント。入院日を 1、入院前日を -1 とし 0 は使わない(ePath の
  # EventElapsedDays と同じ数え方)。並びは表示順ではなく病日で決める。
  class PathwayEvent < ApplicationRecord
    self.table_name = "master_pathway_events"

    # 許容経過日数条件の起点日種別: 1 前回イベント / 2 適用開始日 / 3 指定日付
    ALLOWABLE_CONDITION_TYPES = %w[1 2 3].freeze

    has_many :oat_units, -> { in_display_order },
             class_name: "Master::PathwayOatUnit", foreign_key: :event_id

    validates :pathway_code, :phase_key, presence: true
    validates :elapsed_days, numericality: { only_integer: true, other_than: 0 }
    # 1 行ずつ作るときの重なりの検査。分岐先のフェーズどうしは同じ病日から始まるので、
    # 重なってはいけないのはフェーズの中だけ。まとめて置換するときは送られてきた配列の中で見る
    # (PathwaysController#replace_children)。DB の一意インデックスが最後の砦。
    validates :elapsed_days, uniqueness: { scope: %i[pathway_code phase_key path_step], message: "が重複しています" },
                             on: :create
    validates :path_step, numericality: { only_integer: true, greater_than_or_equal_to: 1 }
    validates :allowable_condition_type, inclusion: { in: ALLOWABLE_CONDITION_TYPES }, allow_blank: true
    validates :allowable_days, :allowable_range_low, :allowable_range_high,
              numericality: { only_integer: true }, allow_nil: true
    validate :allowable_range_is_ordered

    scope :in_day_order, -> { order(:elapsed_days, :path_step, :id) }

    # ePath の action.id(病日[-パスステップ])。
    def event_key
      path_step.to_i <= 1 ? elapsed_days.to_s : "#{elapsed_days}-#{path_step}"
    end

    private

    def allowable_range_is_ordered
      return if allowable_range_low.blank? || allowable_range_high.blank?
      return if allowable_range_low <= allowable_range_high

      errors.add(:allowable_range_high, "は下限以上にしてください")
    end
  end
end
