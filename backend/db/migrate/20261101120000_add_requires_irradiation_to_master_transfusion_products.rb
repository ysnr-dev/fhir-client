# 輸血製剤に「放射線照射が要るか」を持たせる(docs/transfusion-order-design.md §3)。
# 出庫入力で未照射のバッグを出そうとしたときの警告に使う(JAHIS 患者安全ガイド 輸血編 7.3.3-7)。
# 赤血球・血小板・全血は照射が要り、血漿・自己血・アルブミンは要らないのが通例だが、
# 施設の採用製剤で決まるのでマスタの列にする。
class AddRequiresIrradiationToMasterTransfusionProducts < ActiveRecord::Migration[8.0]
  def change
    add_column :master_transfusion_products, :requires_irradiation, :boolean, null: false, default: false
  end
end
