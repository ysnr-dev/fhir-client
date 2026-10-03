# 施設のタイムゾーン(日本時間)での「今日」と「いま」。
# config.time_zone は未設定(UTC)なので、Date.current は日本時間の朝 9 時前に前日を返す。
# 診療上の日付(マスタの有効期間、承認日、掲載日など)はここから取る。
module FacilityClock
  ZONE = ActiveSupport::TimeZone["Asia/Tokyo"]

  def self.now
    Time.current.in_time_zone(ZONE)
  end

  def self.today
    now.to_date
  end
end
