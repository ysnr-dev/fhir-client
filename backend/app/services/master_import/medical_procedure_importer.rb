module MasterImport
  # Parses the medical procedure master CSV (s_ALL*.csv, no header row, 150 columns)
  # and replaces master_medical_procedures wholesale within one transaction.
  #
  # レイアウトは診療報酬情報提供サービスの「ファイルレイアウト」(R08rec3.pdf)
  # 〈医科診療行為マスター〉の項番順。予備(未使用)の項目も落とさず取り込む。
  # 繰り返し項目(施設基準①〜⑩、年齢加算①〜④)は連番を付けて平坦に展開する。
  class MedicalProcedureImporter < CsvImporter
    # 項番 1〜71。
    HEAD_COLUMNS = %i[
      change_category master_type procedure_code
      name_kanji_length name name_kana_length name_kana
      data_standard_code data_standard_name_length data_standard_name
      point_type points
      inpatient_outpatient_category elderly_category
      point_column_outpatient bundled_test reserve1 dpc_category
      hospital_clinic_category image_surgery_support_category
      medical_observation_act_category nursing_addition anesthesia_category
      reserve2 disease_relation_category reserve3
      actual_days days_or_times medicine_relation_category
      increment_calc_type increment_lower_limit increment_upper_limit
      increment_value increment_points increment_error_handling
      max_times max_times_error_handling
      note_addition_code note_addition_serial general_rule_age
      lower_age_limit upper_age_limit time_addition_category
      standard_conformity_category target_facility_standard
      treatment_infant_addition_category very_low_birth_weight_addition_category
      admission_fee_reduction_target donor_aggregation_category
      test_judgment_category test_judgment_group_category degression_target_category
      spinal_evoked_potential_addition_category neck_dissection_addition_category
      auto_suture_addition_category outpatient_management_addition_category
      reserve4 reserve5 name_change_flag kana_change_flag
      lab_test_comment general_rule_addition_target_category
      bundled_degression_category endoscopic_ultrasound_addition_category
      reserve6 point_column_inpatient auto_anastomosis_addition_category
      notification_category_1 notification_category_2
      regional_addition bed_count_category
    ].freeze

    # 項番 72〜81。施設基準コードの 10 回繰り返し。
    FACILITY_STANDARD_COLUMNS = (1..10).map { |i| :"facility_standard_code_#{i}" }.freeze

    # 項番 82〜99。
    MIDDLE_COLUMNS = %i[
      ultrasonic_coagulation_addition_category short_stay_surgery dental_category
      code_table_number_alpha notification_number_alpha
      changed_on abolished_on publication_order
      code_table_chapter code_table_part code_table_section code_table_branch code_table_item
      notification_chapter notification_part notification_section
      notification_branch notification_item
    ].freeze

    # 項番 100〜111。年齢加算の 4 回繰り返し(下限年齢・上限年齢・注加算診療行為コード)。
    AGE_ADDITION_COLUMNS = (1..4).flat_map do |i|
      [:"age_addition_lower_age_#{i}", :"age_addition_upper_age_#{i}",
       :"age_addition_procedure_code_#{i}"]
    end.freeze

    # 項番 112〜137。
    TAIL_COLUMNS = %i[
      reserve7 basic_name
      sinus_endoscope_addition sinus_bone_tissue_resection_addition
      long_anesthesia_management_addition point_table_section_number
      monitoring_addition cryopreserved_tissue_addition
      malignant_tumor_pathology_addition external_fixator_addition
      ultrasonic_cutting_addition laa_closure_addition
      outpatient_infection_control_addition ent_infant_treatment_addition
      ent_pediatric_antimicrobial_addition npwt_device_addition
      nursing_staff_treatment_improvement
      outpatient_home_base_up_1 outpatient_home_base_up_2
      remanufactured_single_use_device_addition
      price_response_category price_response_group_category
      organ_transplant_system_addition endoscopic_surgery_support_device_addition
      remote_e_prescription_addition surgical_care_special_addition
    ].freeze

    # 項番 138〜150。すべて予備(未使用)。
    RESERVED_TAIL_COLUMNS = (8..20).map { |i| :"reserve#{i}" }.freeze

    self.model = Master::MedicalProcedure
    self.columns = (
      HEAD_COLUMNS + FACILITY_STANDARD_COLUMNS + MIDDLE_COLUMNS +
      AGE_ADDITION_COLUMNS + TAIL_COLUMNS + RESERVED_TAIL_COLUMNS
    ).freeze
    self.decimal_columns = %i[points increment_points].freeze
    self.search_columns = { search_name: :name, search_kana: :name_kana }.freeze
  end
end
