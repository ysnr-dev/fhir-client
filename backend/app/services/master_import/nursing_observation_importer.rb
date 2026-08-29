module MasterImport
  # MEDIS 看護実践用語標準マスター 看護観察編(kansatsu-ver.*.txt、cp932、ヘッダあり、46 列)。
  class NursingObservationImporter < CsvImporter
    self.model = Master::NursingObservation
    self.headers = true
    self.columns = (
      %i[change_category manage_no] +
      (1..8).map { |n| :"search_category_#{n}" } +
      %i[advanced_category name kana focus site phase other criteria
         result_manage_no expression_type unit] +
      (1..18).map { |n| :"result_#{n}" } +
      %i[updated_on successor_manage_no name2 unit_code result_group_code adoption_category exchange_code]
    ).freeze
    self.search_columns = { search_name: :name, search_kana: :kana }.freeze

    private

    def row_attrs(attrs, now)
      attrs[:active] = Master::NursingObservation.active_row?(attrs[:change_category], attrs[:successor_manage_no])
      super
    end
  end
end
