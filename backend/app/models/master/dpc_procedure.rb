module Master
  # DPC 電子点数表の分岐「手術・処置等１/２」の定義(７）・８）)。kind が 1 か 2。
  class DpcProcedure < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_procedures"
  end
end
