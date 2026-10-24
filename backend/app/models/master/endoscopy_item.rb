module Master
  # 内視鏡オーダー項目。検査種別はコードで master_endoscopy_exam_types に緩く紐づく。
  # JED はオーダー項目を一意に定義するコード体系を持たないので、項目は施設定義とし、
  # JED とは検査種別を介して繋ぐ。定義の本体は OrderItemModel(生理検査・処置と同型)。
  class EndoscopyItem < ApplicationRecord
    self.table_name = "master_endoscopy_items"
    include Master::OrderItemModel
  end
end
