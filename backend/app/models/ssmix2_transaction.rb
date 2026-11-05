# 上流 FHIR へ書けた transaction の控え(docs/ssmix2-export-design.md §4)。
# request は送られた Bundle かリソース、response は transaction-response か作成・更新後のリソース
# (DELETE は nil)。院内エージェントのポーリングで HL7 に起こされ、done / skipped / failed になる。
class Ssmix2Transaction < ApplicationRecord
  # discarded は失敗を画面で破棄したもの(メッセージに起こさずに諦めた)。
  STATUSES = %w[pending building done skipped failed discarded].freeze
  METHODS = %w[POST PUT DELETE].freeze
  # 組み立てに失敗した transaction を諦めるまでの回数。
  MAX_ATTEMPTS = 5
  # building のまま放置された行を pending に戻すまでの時間(組み立て中にプロセスが落ちたとき)。
  BUILDING_TIMEOUT = 10.minutes
  # done / skipped の行を残す期間。
  RETENTION = 14.days

  validates :occurred_at, :method, :status, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :method, inclusion: { in: METHODS }

  scope :pending, -> { where(status: "pending") }

  # 組み立て中に落ちたプロセスが握ったままの行を戻す。
  def self.release_stale!
    where(status: "building").where(leased_at: ...BUILDING_TIMEOUT.ago).update_all(status: "pending", leased_at: nil)
  end

  def self.purge_processed!
    where(status: %w[done skipped discarded]).where(processed_at: ...RETENTION.ago).delete_all
  end

  # 画面からの再実行。試行回数を数え直して、次のポーリングで組み立て直す。
  def self.retry!(ids)
    where(id: ids, status: "failed").update_all(status: "pending", attempts: 0, error: nil, leased_at: nil,
                                               processed_at: nil, updated_at: Time.current)
  end

  def self.discard!(ids)
    now = Time.current
    where(id: ids, status: "failed").update_all(status: "discarded", processed_at: now, updated_at: now)
  end

  # 書き込みに含まれるリソースの種別(画面の表示用)。
  def resource_types
    body = request.is_a?(Hash) ? request : {}
    if body["resourceType"] == "Bundle"
      Array(body["entry"]).filter_map { |entry| entry.dig("resource", "resourceType") || entry.dig("request", "url").to_s.split(%r{[/?]}).first.presence }.uniq
    else
      [body["resourceType"].presence || path.to_s.delete_prefix("/").split("/").first].compact
    end
  end
end
