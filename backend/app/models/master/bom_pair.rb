module Master
  # BOM の OAT の組(アウトカムコード → 観察項目コード)。アウトカムの取込と同じ transaction で入れ替える。
  class BomPair < ApplicationRecord
    self.table_name = "master_bom_pairs"

    validates :outcome_code, :assessment_code, presence: true
  end
end
