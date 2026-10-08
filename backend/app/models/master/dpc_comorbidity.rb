module Master
  # DPC 電子点数表の分岐「定義副傷病」の定義(９）定義副傷病名)。
  class DpcComorbidity < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_comorbidities"
  end
end
