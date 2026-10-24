module Master
  # 処置オーダー項目。生理検査・内視鏡との違いは検査種別(分類軸)と既定テンプレートを
  # 持たないこと(列が無いだけで、検証と保存前の整えは OrderItemModel で同じ)。
  # 処置は項目名そのものが内容を表し、オーダー画面にも検査目的・特別指示の欄が無い。
  class TreatmentItem < ApplicationRecord
    self.table_name = "master_treatment_items"
    include Master::OrderItemModel
  end
end
