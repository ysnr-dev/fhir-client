module Master
  # ATC 分類(2〜4 階層目)の名称。取込で全件を入れ替える。docs/drug-check-master-design.md
  class AtcClass < ApplicationRecord
    self.table_name = "master_atc_classes"
  end
end
