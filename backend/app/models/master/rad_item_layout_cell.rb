module Master
  # 放射線オーダーレイアウトの1マス。放射線オーダー項目(item)か表示専用の
  # ラベル(label)のどちらかが入る。位置はレイアウト内で一意。
  class RadItemLayoutCell < ApplicationRecord
    self.table_name = "master_rad_item_layout_cells"

    include ItemLayoutCellModel
  end
end
