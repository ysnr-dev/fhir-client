module Master
  # 警告を無視して登録するときに選ぶ理由のマスタ(docs/advisory-design.md §3.1)。
  # CDS Hooks のカードの既定の無視理由もここから出す。
  class AdvisoryOverrideReason < ApplicationRecord
    self.table_name = "master_advisory_override_reasons"

    validates :code, presence: true, uniqueness: true, format: { with: /\A[a-z0-9][a-z0-9-]*\z/ }
    validates :name, presence: true
  end
end
