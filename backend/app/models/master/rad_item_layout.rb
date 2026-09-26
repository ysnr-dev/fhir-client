module Master
  # 放射線オーダー画面の項目配置(伝票のようなグリッド)。グリッドの大きさと
  # 名前を持ち、1マスの中身は RadItemLayoutCell が持つ。
  class RadItemLayout < ApplicationRecord
    self.table_name = "master_rad_item_layouts"

    include ItemLayoutModel
  end
end
