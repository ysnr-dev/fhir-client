# 検体検査結果の取込バッチ 1 件(= アップロードした 1 ファイル)。
#
# ファイルの解析結果と行ごとの状態だけを持つ作業キューで、上流 FHIR への登録は
# 取込画面が既存の結果登録経路(useCreateLabResult / useUpdateLabResult)で行う。
# 判定・通知・報告区分の遷移がすべて frontend にあり、Ruby に複製すると二重保守に
# なるため(docs/lab-result-import-design.md §2)。
class LabResultImport < ApplicationRecord
  FORMATS = %w[hl7_v25].freeze

  has_many :rows, class_name: "LabResultImportRow", dependent: :delete_all,
                  foreign_key: :lab_result_import_id, inverse_of: :import

  validates :format, inclusion: { in: FORMATS }

  scope :recent, -> { order(created_at: :desc, id: :desc) }

  # 画面の件数表示(保留 / 登録待ち / 登録済み / 対象外)。
  def status_counts
    rows.group(:status).count
  end

  # 一覧で N+1 を避けるための一括版。
  def self.status_counts_for(ids)
    LabResultImportRow.where(lab_result_import_id: ids)
                      .group(:lab_result_import_id, :status).count
                      .each_with_object({}) do |((import_id, status), count), memo|
      (memo[import_id] ||= {})[status] = count
    end
  end
end
