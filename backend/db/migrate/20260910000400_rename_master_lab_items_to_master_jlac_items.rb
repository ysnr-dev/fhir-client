class RenameMasterLabItemsToMasterJlacItems < ActiveRecord::Migration[8.0]
  # 配布の共有項目JLACコードマスタ。施設の項目マスタ(master_lab_order_items /
  # master_lab_result_items)と名前が紛らわしく、役割(配布コードマスタ)が伝わらないため改名する。
  # 索引の名前は rename_table が既定名のものを追随させる。
  def change
    rename_table :master_lab_items, :master_jlac_items
  end
end
