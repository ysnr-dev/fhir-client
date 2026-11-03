module MasterImport
  # BOM の観察項目マスター(観察項目管理番号・分類・観察項目コード・名称 1/2・MEDIS 観察名称管理番号)。
  # 見出しは JAHIS ePath 実装ガイド 表 6-5-2-1-2-1-2 の列名に合わせ、表記ゆれの候補を並べる。
  class BomAssessmentImporter < BomSheetImporter
    self.model = Master::BomAssessment
    self.labels = {
      manage_no: %w[観察項目管理番号 管理番号],
      category_code: %w[観察項目分類コード 分類コード],
      category_name: %w[観察項目分類名称 観察項目分類名 分類名称 分類名],
      assessment_code: %w[観察項目コード コード],
      name: %w[観察項目名称1 観察項目名称 観察項目名 観察項目 名称],
      name2: %w[観察項目名称2],
      medis_manage_no: %w[MEDIS観察名称管理番号1(コード) MEDIS観察名称管理番号1 MEDIS観察名称管理番号 MEDIS管理番号],
      medis_name: %w[MEDIS観察名称 MEDIS名称],
    }
    self.required = %i[assessment_code name]

    private

    def search_name(row)
      Master::SearchNormalizer.normalize([row[:name], row[:name2]].compact.join(" "))
    end
  end
end
