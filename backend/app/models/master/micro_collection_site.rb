module Master
  # 細菌検査オーダーの採取部位。laterality_applicable が true の部位を選んだ
  # ときだけ、オーダー画面の左右セレクトが有効になる。
  # seed で初期値を投入し、以後は画面でメンテする施設マスタ。
  class MicroCollectionSite < ApplicationRecord
    self.table_name = "master_micro_collection_sites"

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
  end
end
