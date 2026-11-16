module MasterImport
  # 成分マスタの取込。ファイルは rake medicine_ingredients:generate が作る
  # (UTF-8、ヘッダーあり、5 列)。
  class MedicineIngredientImporter < CsvImporter
    self.model = Master::MedicineIngredient
    self.encoding = :utf8
    self.headers = true
    self.columns = %i[code_prefix ingredient_id name name_ja rxcui].freeze

    private

    def row_attrs(attrs, now)
      super.merge(name_ja: attrs[:name_ja].presence, rxcui: attrs[:rxcui].presence)
    end
  end
end
