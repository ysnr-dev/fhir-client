module Master
  # 処置オーダーレイアウトの1マス。処置オーダー項目(item)か表示専用の
  # ラベル(label)のどちらかが入る。位置はレイアウト内で一意。
  class TreatmentItemLayoutCell < ApplicationRecord
    self.table_name = "master_treatment_item_layout_cells"

    include ItemLayoutCellModel
  end
end
