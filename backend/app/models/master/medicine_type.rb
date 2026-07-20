module Master
  # 薬効分類マスタ。code は薬効分類番号（4桁）、name はその名称。
  # 医薬品(master_medicines)とは yakka_code の上4桁 = code で対応する。
  class MedicineType < ApplicationRecord
    self.table_name = "master_medicine_types"

    validates :code, presence: true, uniqueness: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
    end
  end
end
