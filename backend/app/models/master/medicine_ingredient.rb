module Master
  # 成分マスタ(コードの上 7 桁・上 9 桁 → 成分)。取込で全件を入れ替える。
  # docs/drug-check-master-design.md
  class MedicineIngredient < ApplicationRecord
    self.table_name = "master_medicine_ingredients"
  end
end
