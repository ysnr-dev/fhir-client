class AddRequiresLateralityToMasterSurgeryItems < ActiveRecord::Migration[8.0]
  # この術式では申込時に左右(bodySite の R/L/B)の選択を必須にするか。
  #
  # 左右の取り違えは WHO 手術安全チェックリストの最重要項目だが、左右の無い臓器
  # (胃・虫垂 など)まで一律に必須にすると、意味の無い「指定なし」を選ぶ手数が増える。
  # 左右のある術式(鼠径ヘルニア・人工関節置換 など)だけを術式マスタで印付けし、
  # 申込画面はその印を見て必須にする。
  #
  # 既定は false。左右のある術式の方が少なく、例外の方を印付ける運用にする。
  def change
    add_column :master_surgery_items, :requires_laterality, :boolean, null: false, default: false
  end
end
