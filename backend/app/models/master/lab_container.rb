module Master
  # 採取管(採血管・採尿容器など)。容器の呼称・キャップ色はメーカーや施設で
  # 変わるので定数ではなくマスタにしている。
  class LabContainer < ApplicationRecord
    self.table_name = "master_lab_containers"

    validates :container_code, presence: true, uniqueness: true
    validates :name, presence: true
  end
end
