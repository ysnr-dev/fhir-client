module Master
  # 検査オーダー画面の項目配置(検査伝票のようなグリッド)。グリッドの大きさと
  # 名前を持ち、1マスの中身は LabOrderItemLayoutCell が持つ。
  class LabOrderItemLayout < ApplicationRecord
    self.table_name = "master_lab_order_item_layouts"

    include ItemLayoutModel
  end
end
