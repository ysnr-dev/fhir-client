# 輸血製剤に有効日数(採血日からの日数)を持たせる(docs/transfusion-order-design.md §3)。
# 自己血の採血で有効期限を自動で決めるのに使う(JAHIS 患者安全ガイド 輸血編 7.7.3-2。
# 手入力で期限を変えられないようにするため、日数はマスタに置く)。
class AddShelfLifeDaysToMasterTransfusionProducts < ActiveRecord::Migration[8.0]
  def change
    add_column :master_transfusion_products, :shelf_life_days, :integer
  end
end
