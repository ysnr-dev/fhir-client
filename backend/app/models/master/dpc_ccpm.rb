module Master
  # DPC 電子点数表の診断群分類と CCPM 支払分類の対応(14）CCPM対応)。
  class DpcCcpm < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_ccpms"
  end
end
