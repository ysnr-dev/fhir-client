module Master
  # 内視鏡オーダーレイアウトの1マス。内視鏡オーダー項目(item)か表示専用の
  # ラベル(label)のどちらかが入る。位置はレイアウト内で一意。
  class EndoscopyItemLayoutCell < ApplicationRecord
    self.table_name = "master_endoscopy_item_layout_cells"

    include ItemLayoutCellModel
  end
end
