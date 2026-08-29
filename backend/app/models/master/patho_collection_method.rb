module Master
  # 病理検査オーダーの採取法(JAHIS 病理・臨床細胞データ交換規約 付録-3
  # テーブル LPATHO004)。seed で初期値を投入し、以後は画面でメンテする施設マスタ。
  class PathoCollectionMethod < ApplicationRecord
    self.table_name = "master_patho_collection_methods"

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
  end
end
