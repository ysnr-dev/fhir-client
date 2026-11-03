module MasterImport
  # BOM のアウトカム(管理番号・大分類・中分類・アウトカムコード・名称)。配布ファイルの本体シートは
  # 1 行が「アウトカム × 観察項目」の組なので、アウトカムは重複を除いて入れ、組は master_bom_pairs に入れる。
  # 見出しは JAHIS ePath 実装ガイド 表 6-5-2-1-2-2 と配布ファイル(BOM Ver.2.2)の列名に合わせる。
  class BomOutcomeImporter < BomSheetImporter
    self.model = Master::BomOutcome
    self.labels = {
      manage_no: %w[管理番号 アウトカム管理番号],
      category_code: %w[大分類コード アウトカム大分類コード],
      category_name: %w[大分類名称 大分類名 アウトカム大分類名称],
      subcategory_code: %w[中分類コード アウトカム中分類コード],
      subcategory_name: %w[中分類名称 中分類名 アウトカム中分類名称],
      outcome_code: %w[アウトカムコード],
      outcome_name: %w[アウトカム名称 アウトカム名],
      pair_assessment_code: %w[観察項目コード],
      pair_assessment_name: %w[観察項目名称 観察項目名称1 観察項目名],
    }
    self.required = %i[outcome_code outcome_name]
    self.columns = %i[manage_no category_code category_name subcategory_code subcategory_name outcome_code outcome_name]

    private

    def search_name(row)
      Master::SearchNormalizer.normalize(row[:outcome_name])
    end

    # OAT の組(アウトカム → 観察項目)。同じ組は先の行を残す。
    def import_extra(rows, now)
      pairs = {}
      rows.each do |row|
        next if row[:pair_assessment_code].blank?

        key = [row[:outcome_code], row[:pair_assessment_code]]
        pairs[key] ||= {
          outcome_code: row[:outcome_code], assessment_code: row[:pair_assessment_code],
          assessment_name: row[:pair_assessment_name], display_order: pairs.size + 1,
          created_at: now, updated_at: now
        }
      end
      Master::BomPair.delete_all
      pairs.values.each_slice(1000) { |slice| Master::BomPair.insert_all!(slice) }
    end
  end
end
