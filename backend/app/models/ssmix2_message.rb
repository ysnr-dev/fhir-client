# 院内エージェントに渡す SS-MIX2 のメッセージ 1 件(docs/ssmix2-export-design.md §5.4)。
# ヘッダー項目(ファイル名とフォルダを決める値)と、CP50221 に変換した電文の本体を持つ。
class Ssmix2Message < ApplicationRecord
  # discarded は失敗を画面で破棄したもの(書かずに諦めた)。
  STATUSES = %w[pending leased written failed discarded].freeze
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
    where(status: "discarded").where(updated_at: ...RETENTION.ago).delete_all
  end

  # 画面からの再実行。試行回数を数え直して、次のポーリングで配り直す。
  def self.retry!(ids)
    where(id: ids, status: "failed").update_all(status: "pending", attempts: 0, error: nil, leased_at: nil, updated_at: Time.current)
  end

  def self.discard!(ids)
    where(id: ids, status: "failed").update_all(status: "discarded", updated_at: Time.current)
  end

  # 画面(SS-MIX2 出力の確認)に出す 1 件。本体の電文は返さない。
  def summary_json
    {
      id: id, created_at: created_at, updated_at: updated_at, patient_id: patient_id, service_date: service_date,
      data_kind: data_kind, order_no: order_no, process: process, status: status, attempts: attempts,
      file_stem: file_stem, error: error, warnings: warnings
    }
  end

  # ファイル名(拡張子なし、コンディションフラグ除く)。エージェントは末尾にフラグを足す。
  def file_stem
    [patient_id, service_date, data_kind, order_no, transaction_at, department_code.presence || "-"].join("_")
  end
end
