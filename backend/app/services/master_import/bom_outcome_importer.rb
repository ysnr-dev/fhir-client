module MasterImport
  # BOM のアウトカムマスター(管理番号・大分類・中分類・アウトカムコード・名称)。
  # 見出しは JAHIS ePath 実装ガイド 表 6-5-2-1-2-2 の列名に合わせ、表記ゆれの候補を並べる。
  class BomOutcomeImporter < BomSheetImporter
    self.model = Master::BomOutcome
    self.labels = {
      manage_no: %w[管理番号 アウトカム管理番号],
      category_code: %w[大分類コード アウトカム大分類コード],
      category_name: %w[大分類名称 大分類名 アウトカム大分類名称],
      subcategory_code: %w[中分類コード アウトカム中分類コード],
      subcategory_name: %w[中分類名称 中分類名 アウトカム中分類名称],
      outcome_code: %w[アウトカムコード コード],
      outcome_name: %w[アウトカム名称 アウトカム名 アウトカム 名称],
    }
    self.required = %i[outcome_code outcome_name]

    private

    def search_name(row)
      Master::SearchNormalizer.normalize(row[:outcome_name])
    end
  end
end
