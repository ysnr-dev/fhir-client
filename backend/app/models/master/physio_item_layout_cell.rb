module Master
  # 生理検査オーダーレイアウトの1マス。生理検査オーダー項目(item)か表示専用の
  # ラベル(label)のどちらかが入る。位置はレイアウト内で一意。
  class PhysioItemLayoutCell < ApplicationRecord
    self.table_name = "master_physio_item_layout_cells"

    include ItemLayoutCellModel
  end
end
