module MasterImport
  # Parses the medical material master CSV (t_ALL*.csv, no header row, 38 columns)
  # and replaces master_medical_materials wholesale within one transaction.
  #
  # レイアウトは診療報酬情報提供サービスの「ファイルレイアウト」(R08rec3.pdf)
  # 〈特定器材マスター〉の項番順。予備(未使用)の項目も落とさず取り込む。
  class MedicalMaterialImporter < CsvImporter
    self.model = Master::MedicalMaterial
    # 項番17・18はレコード仕様上「予備(未使用)」。実データでは改定前の金額種別・金額が
    # 残っている行があるが、仕様が未使用と定める以上これを算定には使わない
    # (医薬品マスターと違い、旧金額として定義されていない)。
    self.columns = %i[
      change_category master_type material_code
      name_kanji_length name name_kana_length name_kana
      unit_code unit_name_length unit_name
      price_type price
      reserve1 age_addition_category lower_age_limit upper_age_limit
      reserve2 reserve3
      name_change_flag kana_change_flag oxygen_category material_category
      price_cap_flag price_cap_points
      reserve4 publication_order abolition_related_code
      changed_on transitional_measure_on abolished_on
      notification_table_number notification_section_number dpc_category
      reserve5 reserve6 reserve7
      basic_name remanufactured_single_use_device
    ].freeze
    self.decimal_columns = %i[price].freeze
    self.search_columns = { search_name: :name, search_kana: :name_kana }.freeze
  end
end
