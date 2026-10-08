module Master
  # DPC 電子点数表の分岐の値の組から診断群分類(14 桁)を決める変換テーブル(12）)。
  class DpcConversion < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_conversions"
  end
end
