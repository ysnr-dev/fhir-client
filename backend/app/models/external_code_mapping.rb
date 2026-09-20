# カルテ側のコード ↔ 外部システム側のコードの対応表。
#
# どの種別(kind)を持つかは外部システムのアダプタが宣言する。
# 表は製品(system_type)のコード体系に対する対応。
class ExternalCodeMapping < ApplicationRecord
  validates :system_type, presence: true
  validates :kind, presence: true
  validates :local_key, presence: true
  validates :external_code, presence: true
  validates :local_key, uniqueness: { scope: %i[system_type kind] }

  scope :for_kind, ->(system_type, kind) { where(system_type: system_type, kind: kind) }
end
