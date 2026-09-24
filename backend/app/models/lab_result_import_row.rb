# 取込ファイルの検査結果 1 件(HL7 の OBX 1 セグメント)。
#
# 患者・オーダー・検体のヘッダは行に非正規化して持つ。保留になる単位が行(項目)で、
# 候補のまとまりは group_no で復元できるため、レポート候補のテーブルを別に作らない。
# 訂正で同じ患者・同じ日の結果が繰り返し来るので、行の独立性が高い方が扱いやすい。
class LabResultImportRow < ApplicationRecord
  # pending: 結果項目を引き当てられず人の手が要る / ready: 登録待ち
  # skipped: 取り込まない / registered: 上流に登録済み
  STATUSES = %w[pending ready skipped registered].freeze
  # どの手掛かりで結果項目に当たったか。manual は人が選んだもの。
  RESOLUTIONS = %w[jlac10 jlac11 jlac10_prefix jlac11_prefix manual].freeze
  # 保留の理由。item_ambiguous は前方一致で複数当たった状態(候補は candidate_item_codes)。
  PENDING_REASONS = %w[item_unresolved item_ambiguous value_unmatched value_not_numeric].freeze

  belongs_to :import, class_name: "LabResultImport", foreign_key: :lab_result_import_id,
                      inverse_of: :rows

  validates :status, inclusion: { in: STATUSES }
  validates :resolution, inclusion: { in: RESOLUTIONS }, allow_blank: true
  validates :pending_reason, inclusion: { in: PENDING_REASONS }, allow_blank: true

  scope :ordered, -> { order(:group_no, :sequence, :id) }
  scope :pending, -> { where(status: "pending") }
end
