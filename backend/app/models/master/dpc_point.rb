module Master
  # DPC 電子点数表の診断群分類ごとの入院期間と点数(11）診断群分類点数表)。
  class DpcPoint < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_points"
  end
end
