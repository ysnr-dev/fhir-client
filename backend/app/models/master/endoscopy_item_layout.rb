module Master
  # 内視鏡オーダー画面の項目配置(伝票のようなグリッド)。グリッドの大きさと
  # 名前を持ち、1マスの中身は EndoscopyItemLayoutCell が持つ。
  class EndoscopyItemLayout < ApplicationRecord
    self.table_name = "master_endoscopy_item_layouts"

    include ItemLayoutModel
  end
end
