# 「自院」がどの Organization かを指す単一行モデル。
#
# 本アプリはマルチテナントではなく、スタッフ・診療科・診察室は自院のものしか
# 登録しない。一方で診療情報提供書の送付先候補として他院の医療機関・医師も
# Organization / Practitioner として登録するため、「どれが自院か」を宣言する
# 場所が要る。ここがその唯一の宣言で、backend(処方箋 PDF の医療機関欄)と
# frontend(各マスタの所属既定値・帳票の自院欄)が同じ値を参照する。
#
# 接続設定(FhirConnectionSettings)とは分けている。あちらは「どのサーバーに
# 繋ぐか」というインフラ設定で秘密情報を持ち管理者しか読めないが、こちらは
# 業務設定でログイン済みユーザー全員が読む。
class FacilitySettings < ApplicationRecord
  # 単一行の強制: ガード列は常に 0。一意インデックス(migration)と合わせて 2 行目を弾く。
  attribute :singleton_guard, :integer, default: 0
  validates :singleton_guard, inclusion: { in: [0] }, uniqueness: true

  # 看護指示の既定時刻。"daily" は「1日N回」の N ごとの時刻、"interval_start" は
  # 「N時間毎」の起点。指示を登録するときの初期値に使うだけで、登録済みの指示には
  # 時刻が焼き付いている(ここを変えても過去の指示は動かない)。
  DEFAULT_NURSING_SCHEDULE = {
    "daily" => {
      "1" => ["10:00"],
      "2" => ["10:00", "18:00"],
      "3" => ["09:00", "14:00", "20:00"],
      "4" => ["06:00", "10:00", "14:00", "18:00"]
    },
    "interval_start" => "06:00"
  }.freeze

  # 食事の提供時刻。退院・外出泊の日時から「その時刻までに出た最後の食事」「その時刻以降の
  # 最初の食事」を決めるのに使う。食事オーダーの occurrenceDateTime に焼く 08/12/18 は
  # SS-MIX2 のコードで、ここの時刻とは別物(この設定を変えてもオーダーの時刻は動かない)。
  DEFAULT_MEAL_SCHEDULE = {
    "breakfast" => "08:00",
    "lunch" => "12:00",
    "dinner" => "18:00"
  }.freeze

  TIME_PATTERN = /\A([01]\d|2[0-3]):[0-5]\d\z/

  validate :nursing_schedule_shape
  validate :meal_schedule_shape

  # 欠けたキーを既定値で埋めた看護指示の既定時刻。読み出しは常にこちらを使う。
  def nursing_schedule_with_defaults
    stored = nursing_schedule.is_a?(Hash) ? nursing_schedule : {}
    {
      "daily" => DEFAULT_NURSING_SCHEDULE["daily"].merge(stored["daily"].is_a?(Hash) ? stored["daily"] : {}),
      "interval_start" => stored["interval_start"].presence || DEFAULT_NURSING_SCHEDULE["interval_start"]
    }
  end

  # 欠けたキーを既定値で埋めた食事の提供時刻。
  def meal_schedule_with_defaults
    stored = meal_schedule.is_a?(Hash) ? meal_schedule : {}
    DEFAULT_MEAL_SCHEDULE.transform_values.with_index do |default, index|
      key = DEFAULT_MEAL_SCHEDULE.keys[index]
      stored[key].presence || default
    end
  end

  class << self
    # 単一行を遅延生成して返す。
    def current
      first_or_create!
    end

    # 自院の Organization.id。未設定なら nil(呼び出し側は従来の推測に倒す)。
    def self_organization_id
      current.self_organization_fhir_id.presence
    end

    def nursing_schedule
      current.nursing_schedule_with_defaults
    end

    def meal_schedule
      current.meal_schedule_with_defaults
    end
  end

  private

  def meal_schedule_shape
    return if meal_schedule.blank?
    return errors.add(:meal_schedule, "は連想配列で指定してください") unless meal_schedule.is_a?(Hash)

    meal_schedule.each do |timing, time|
      unless DEFAULT_MEAL_SCHEDULE.key?(timing)
        errors.add(:meal_schedule, "#{timing} は朝・昼・夕(breakfast/lunch/dinner)のいずれかで指定してください")
        next
      end
      unless time.is_a?(String) && time.match?(TIME_PATTERN)
        errors.add(:meal_schedule, "#{timing} は HH:MM で指定してください")
      end
    end
  end

  def nursing_schedule_shape
    return if nursing_schedule.blank?
    return errors.add(:nursing_schedule, "は連想配列で指定してください") unless nursing_schedule.is_a?(Hash)

    daily = nursing_schedule["daily"]
    if daily.present?
      return errors.add(:nursing_schedule, "daily は連想配列で指定してください") unless daily.is_a?(Hash)

      daily.each do |count, times|
        unless times.is_a?(Array) && times.all? { |t| t.is_a?(String) && t.match?(TIME_PATTERN) }
          errors.add(:nursing_schedule, "daily[#{count}] は HH:MM の配列で指定してください")
        end
      end
    end

    start = nursing_schedule["interval_start"]
    if start.present? && !(start.is_a?(String) && start.match?(TIME_PATTERN))
      errors.add(:nursing_schedule, "interval_start は HH:MM で指定してください")
    end
  end
end
