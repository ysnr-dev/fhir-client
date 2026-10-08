module Master
  # DPC 電子点数表の診断群分類の名称(１）ＭＤＣ名称・２）分類名称)。code は MDC 2 桁か MDC + 分類コードの 6 桁。
  class DpcClassification < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_classifications"
  end
end
