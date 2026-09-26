module Master
  # 処置オーダー画面の項目配置(伝票のようなグリッド)。グリッドの大きさと
  # 名前を持ち、1マスの中身は TreatmentItemLayoutCell が持つ。
  class TreatmentItemLayout < ApplicationRecord
    self.table_name = "master_treatment_item_layouts"

    include ItemLayoutModel
  end
end
