module Master
  # DPC 電子点数表の分岐「手術」の定義(６）手術)。codes の点数表コードをすべて実施したとき該当する。
  class DpcSurgery < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_surgeries"
  end
end
