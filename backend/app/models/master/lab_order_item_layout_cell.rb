module Master
  # 検査オーダーレイアウトの1マス。検査オーダー項目(item)か表示専用の
  # ラベル(label)のどちらかが入る。位置はレイアウト内で一意。
  class LabOrderItemLayoutCell < ApplicationRecord
    self.table_name = "master_lab_order_item_layout_cells"

    include ItemLayoutCellModel

    def self.item_code_column
      :order_item_code
    end
  end
end
