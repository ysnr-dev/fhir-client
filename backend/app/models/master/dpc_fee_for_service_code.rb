module Master
  # DPC 電子点数表の包括の対象外になる手術・検査・患者・薬剤(13）出来高算定手術等コード)。
  class DpcFeeForServiceCode < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_fee_for_service_codes"
  end
end
