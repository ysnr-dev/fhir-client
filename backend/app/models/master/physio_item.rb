module Master
  # 生理検査オーダー項目。検査種別はコードで master_physio_exam_types に緩く紐づく。
  # 定義の本体は OrderItemModel(内視鏡・処置と同型)。
  class PhysioItem < ApplicationRecord
    self.table_name = "master_physio_items"
    include Master::OrderItemModel
  end
end
