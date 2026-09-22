# 放射線治療の照射技法に、医事会計へ送るレセプト電算コードを持たせる
# (docs/receipt-billing-design.md §5)。体外照射は同じ日の 1 回目と 2 回目でコードが違い、
# 放射線治療管理料はコースの初回にだけ付く。技法ごとに違う値なので施設設定ではなくマスタの列。
class AddReceiptCodesToMasterRadiotherapyTechniques < ActiveRecord::Migration[8.0]
  def change
    add_column :master_radiotherapy_techniques, :receipt_code, :string
    add_column :master_radiotherapy_techniques, :receipt_code_second, :string
    add_column :master_radiotherapy_techniques, :management_receipt_code, :string
  end
end
