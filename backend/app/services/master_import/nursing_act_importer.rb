module MasterImport
  # MEDIS 看護実践用語標準マスター 看護行為編(koui-ver.*.txt、cp932、ヘッダあり、18 列)。
  # 4 階層のコードを連結した 16 桁コードと、変更区分から有効フラグをここで作る。
  class NursingActImporter < CsvImporter
    self.model = Master::NursingAct
    self.headers = true
    self.columns = %i[
      change_category manage_no
      level1_code level1_name level1_definition
      level2_code level2_name level2_definition
      level3_code level3_name level3_definition
      level4_code level4_name level4_definition
      example updated_on successor_manage_no sort_key
    ].freeze

    private

    def row_attrs(attrs, now)
      attrs[:sort_key] = attrs[:sort_key].presence&.to_i
      attrs[:code_16] = attrs.values_at(:level1_code, :level2_code, :level3_code, :level4_code).join
      attrs[:active] = Master::NursingAct.active_row?(attrs[:change_category], attrs[:successor_manage_no])
      # 検索は「行為名称 + 修飾語」で当てる(search_columns は 1 列しか取れないので手で入れる)。
      attrs[:search_name] = Master::SearchNormalizer.normalize("#{attrs[:level3_name]}#{attrs[:level4_name]}")
      super
    end
  end
end
