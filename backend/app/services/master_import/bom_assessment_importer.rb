module MasterImport
  # BOM の観察項目(観察項目管理番号・分類・観察項目コード・名称・観察名称管理番号 = MEDIS 看護観察)。
  # 見出しは JAHIS ePath 実装ガイド 表 6-5-2-1-2-1-2 と配布ファイル(BOM Ver.2.2 の「観察項目マスター」)の
  # 列名に合わせる。MEDIS の管理番号は複数列あるが、評価入力で借りるのは 1 つなので 1 列目だけを持つ。
  class BomAssessmentImporter < BomSheetImporter
    self.model = Master::BomAssessment
    self.labels = {
      manage_no: %w[観察項目管理番号],
      category_code: %w[観察項目分類コード 分類コード],
      category_name: %w[観察項目分類名称 観察項目分類名 分類名称 分類名],
      assessment_code: %w[観察項目コード],
      name: %w[観察項目名称 観察項目名称1 観察項目名],
      name2: %w[観察項目名称2],
      medis_manage_no: %w[観察名称管理番号1(コード) 観察名称管理番号1 MEDIS観察名称管理番号1(コード) MEDIS観察名称管理番号1
                          MEDIS観察名称管理番号 MEDIS管理番号],
      medis_name: %w[MEDIS観察名称 観察名称1 MEDIS名称],
    }
    self.required = %i[assessment_code name]
    self.columns = %i[manage_no category_code category_name assessment_code name name2 medis_manage_no medis_name]

    private

    def search_name(row)
      Master::SearchNormalizer.normalize([row[:name], row[:name2]].compact.join(" "))
    end
  end
end
