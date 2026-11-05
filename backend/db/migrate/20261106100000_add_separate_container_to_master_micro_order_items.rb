# 細菌検査の検査項目のうち、検体と別の容器で出すもの(血液培養のボトル)。
# ラベルは容器ごとに刷るので、この項目は 1 項目 = 容器 1 つ = ラベル 1 枚になる。
class AddSeparateContainerToMasterMicroOrderItems < ActiveRecord::Migration[8.0]
  def up
    add_column :master_micro_order_items, :separate_container, :boolean, default: false, null: false

    # seed の初期値(血液培養の好気・嫌気ボトル)。施設で項目を直していても、
    # ボトルの項目だけに立てる。
    execute <<~SQL
      UPDATE master_micro_order_items
         SET separate_container = TRUE
       WHERE item_code IN ('8', '9') AND name LIKE '%ボトル%'
    SQL
  end

  def down
    remove_column :master_micro_order_items, :separate_container
  end
end
