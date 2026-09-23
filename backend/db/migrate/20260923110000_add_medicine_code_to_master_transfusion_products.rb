# 輸血製剤に、医事会計へ送るレセプト電算の医薬品コードを持たせる(docs/receipt-billing-design.md §5)。
# 血液製剤は医薬品として算定するので手技のコードではなく医薬品コード。施設の item_code は
# 独自採番でもよいが、seed は医薬品コードと同じ 9 桁にしてあるので、その行は写しておく。
class AddMedicineCodeToMasterTransfusionProducts < ActiveRecord::Migration[8.0]
  def up
    add_column :master_transfusion_products, :medicine_code, :string
    execute <<~SQL
      UPDATE master_transfusion_products SET medicine_code = item_code WHERE item_code ~ '^[0-9]{9}$'
    SQL
  end

  def down
    remove_column :master_transfusion_products, :medicine_code
  end
end
