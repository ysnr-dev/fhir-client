module Master
  # 薬剤師が処方監査で介入したときの種別(プレアボイド)のマスタ(docs/rx-verification-design.md §4.1)。
  class PharmacistInterventionType < ApplicationRecord
    self.table_name = "master_pharmacist_intervention_types"

    validates :code, presence: true, uniqueness: true, format: { with: /\A[a-z0-9][a-z0-9-]*\z/ }
    validates :name, presence: true
  end
end
