module Master
  # 細菌検査オーダーの採取方法(スワブ / 穿刺 / 吸引 など)。
  # seed で初期値を投入し、以後は画面でメンテする施設マスタ。
  class MicroCollectionMethod < ApplicationRecord
    self.table_name = "master_micro_collection_methods"

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
  end
end
