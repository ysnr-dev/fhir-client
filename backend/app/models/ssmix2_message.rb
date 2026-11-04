# 院内エージェントに渡す SS-MIX2 のメッセージ 1 件(docs/ssmix2-export-design.md §5.4)。
# ヘッダー項目(ファイル名とフォルダを決める値)と、CP50221 に変換した電文の本体を持つ。
class Ssmix2Message < ApplicationRecord
  STATUSES = %w[pending leased written failed].freeze
  PROCESSES = %w[INS DEL].freeze
  # エージェントが取ったまま結果を返さないとき、配り直すまでの時間。
  LEASE = 5.minutes
  MAX_ATTEMPTS = 5
  RETENTION = 14.days

  belongs_to :ssmix2_transaction, optional: true

  validates :patient_id, :service_date, :data_kind, :order_no, :process, :transaction_at, :body, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :process, inclusion: { in: PROCESSES }
  validates :transaction_at, format: { with: /\A\d{17}\z/ }

  scope :pending, -> { where(status: "pending") }

  def self.release_stale!
    where(status: "leased").where(leased_at: ...LEASE.ago).update_all(status: "pending", leased_at: nil)
  end

  def self.purge_written!
    where(status: "written").where(written_at: ...RETENTION.ago).delete_all
  end

  # ファイル名(拡張子なし、コンディションフラグ除く)。エージェントは末尾にフラグを足す。
  def file_stem
    [patient_id, service_date, data_kind, order_no, transaction_at, department_code.presence || "-"].join("_")
  end
end
