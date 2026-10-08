module Master
  # DPC 電子点数表の手術・処置等で使うダミーコード(化学療法・全身麻酔などの区分や薬剤の組)。
  # 有効期間を持たないので、版だけで引く。
  class DpcDummyCode < ApplicationRecord
    self.table_name = "master_dpc_dummy_codes"
  end
end
