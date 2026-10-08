module Master
  # DPC 電子点数表の分岐の条件(３）病態等分類・５）年齢、出生時体重等・10）重症度等)。
  class DpcCondition < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_conditions"
  end
end
