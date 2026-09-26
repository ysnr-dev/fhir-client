module Master
  # 生理検査オーダー画面の項目配置(伝票のようなグリッド)。グリッドの大きさと
  # 名前を持ち、1マスの中身は PhysioItemLayoutCell が持つ。
  class PhysioItemLayout < ApplicationRecord
    self.table_name = "master_physio_item_layouts"

    include ItemLayoutModel
  end
end
