# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.0].define(version: 2026_08_13_030000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "fhir_connection_settings", force: :cascade do |t|
    t.string "base_url"
    t.string "client_id"
    t.text "client_secret"
    t.string "token_path", default: "/oauth/token", null: false
    t.string "host_header"
    t.integer "singleton_guard", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "fhir_admin_token"
    t.index ["singleton_guard"], name: "index_fhir_connection_settings_on_singleton_guard", unique: true
  end

  create_table "master_disease_indexes", force: :cascade do |t|
    t.string "term", null: false
    t.string "target_code", null: false
    t.string "disease_modifier_category"
    t.string "kana_kanji_category"
    t.string "synonym_category"
    t.string "variant_category"
    t.string "first_edition_category"
    t.string "language_category"
    t.string "abbreviation_category"
    t.string "search_term"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["search_term"], name: "index_master_disease_indexes_on_search_term"
    t.index ["target_code"], name: "index_master_disease_indexes_on_target_code"
  end

  create_table "master_diseases", force: :cascade do |t|
    t.string "change_category"
    t.string "management_number", null: false
    t.string "name", null: false
    t.string "name_kana"
    t.string "adoption_category"
    t.string "exchange_code"
    t.string "icd10_2013"
    t.string "icd10_2013_secondary"
    t.string "reserve1"
    t.string "reserve2"
    t.string "receipt_code"
    t.string "abbreviated_name"
    t.string "usage_field"
    t.string "change_history_number"
    t.string "updated_on"
    t.string "transfer_management_number"
    t.string "single_use_prohibited_category"
    t.string "non_billable_category"
    t.string "reserve3"
    t.string "reserve4"
    t.string "search_name"
    t.string "search_kana"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["exchange_code"], name: "index_master_diseases_on_exchange_code"
    t.index ["icd10_2013"], name: "index_master_diseases_on_icd10_2013"
    t.index ["management_number"], name: "index_master_diseases_on_management_number", unique: true
  end

  create_table "master_hot_codes", force: :cascade do |t|
    t.string "hot_code", null: false
    t.string "hot7_code"
    t.string "company_identification_number"
    t.string "dispensing_number"
    t.string "logistics_number"
    t.string "jan_code"
    t.string "yakka_code"
    t.string "individual_medicine_code"
    t.string "receipt_code_1"
    t.string "receipt_code_2"
    t.string "notification_name"
    t.string "sales_name"
    t.string "receipt_medicine_name"
    t.string "standard_unit"
    t.string "package_form"
    t.decimal "package_unit_quantity", precision: 12, scale: 3
    t.string "package_unit_unit"
    t.decimal "package_total_quantity", precision: 12, scale: 3
    t.string "package_total_unit"
    t.string "category"
    t.string "manufacturer"
    t.string "distributor"
    t.string "update_category"
    t.string "updated_on"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["hot7_code"], name: "index_master_hot_codes_on_hot7_code"
    t.index ["hot_code"], name: "index_master_hot_codes_on_hot_code"
    t.index ["individual_medicine_code"], name: "index_master_hot_codes_on_individual_medicine_code"
    t.index ["jan_code"], name: "index_master_hot_codes_on_jan_code"
    t.index ["receipt_code_1"], name: "index_master_hot_codes_on_receipt_code_1"
    t.index ["sales_name"], name: "index_master_hot_codes_on_sales_name"
    t.index ["yakka_code"], name: "index_master_hot_codes_on_yakka_code"
  end

  create_table "master_jfagy_allergens", force: :cascade do |t|
    t.string "display_seq"
    t.string "jfagy_code", null: false
    t.string "name", null: false
    t.string "name_kana"
    t.string "name_en"
    t.string "level"
    t.string "main_flag"
    t.string "guideline"
    t.string "cxg_category"
    t.string "record_date"
    t.string "end_date"
    t.string "search_name"
    t.string "search_kana"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["jfagy_code"], name: "index_master_jfagy_allergens_on_jfagy_code", unique: true
    t.index ["search_kana"], name: "index_master_jfagy_allergens_on_search_kana"
    t.index ["search_name"], name: "index_master_jfagy_allergens_on_search_name"
  end

  create_table "master_lab_containers", force: :cascade do |t|
    t.string "container_code", null: false
    t.string "name", null: false
    t.string "short_name"
    t.string "cap_color"
    t.string "additive"
    t.string "capacity"
    t.integer "display_order"
    t.text "note"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["container_code"], name: "index_master_lab_containers_on_container_code", unique: true
  end

  create_table "master_lab_items", force: :cascade do |t|
    t.string "category_name"
    t.string "reserve_category_name"
    t.string "emergency_flag"
    t.string "lifestyle_disease_flag"
    t.string "data_category"
    t.string "major_item"
    t.string "fhir_item_name"
    t.string "fhir_identifier"
    t.string "abbreviation"
    t.string "sales_name"
    t.string "jlac11_specimen"
    t.string "jlac11_method"
    t.string "jlac11_code", null: false
    t.string "display_unit"
    t.string "display_unit2"
    t.string "xml_unit"
    t.string "xml_unit2"
    t.string "jlac10_specimen"
    t.string "jlac10_method"
    t.string "jlac10_code"
    t.string "reference_lower_flag"
    t.string "reference_upper_flag"
    t.string "reference_judgment_flag"
    t.string "data_type"
    t.string "value_lower_limit"
    t.string "value_upper_limit"
    t.string "numeric_format"
    t.string "code_value_list"
    t.string "code_oid"
    t.string "display_order"
    t.string "start_date"
    t.string "end_date"
    t.string "search_name"
    t.string "search_abbreviation"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "search_major_item"
    t.index ["fhir_item_name"], name: "index_master_lab_items_on_fhir_item_name"
    t.index ["jlac10_code"], name: "index_master_lab_items_on_jlac10_code"
    t.index ["jlac11_code"], name: "index_master_lab_items_on_jlac11_code", unique: true
  end

  create_table "master_lab_order_item_layout_cells", force: :cascade do |t|
    t.integer "layout_id", null: false
    t.integer "grid_row", null: false
    t.integer "grid_column", null: false
    t.string "cell_type", default: "item", null: false
    t.string "order_item_code"
    t.string "display_name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["layout_id", "grid_row", "grid_column"], name: "index_lab_layout_cells_on_layout_and_position", unique: true
    t.index ["order_item_code"], name: "index_master_lab_order_item_layout_cells_on_order_item_code"
  end

  create_table "master_lab_order_item_layouts", force: :cascade do |t|
    t.string "name", null: false
    t.integer "row_count", default: 10, null: false
    t.integer "column_count", default: 5, null: false
    t.integer "display_order"
    t.boolean "active", default: true, null: false
    t.text "note"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["name"], name: "index_master_lab_order_item_layouts_on_name", unique: true
  end

  create_table "master_lab_order_items", force: :cascade do |t|
    t.string "order_item_code", null: false
    t.string "name", null: false
    t.string "short_name"
    t.string "name_kana"
    t.string "category"
    t.string "specimen_code"
    t.string "container_code"
    t.string "kind", default: "single", null: false
    t.string "jlac_code"
    t.string "jlac_code_system"
    t.date "valid_from"
    t.date "valid_to"
    t.string "execution_type"
    t.string "receipt_code"
    t.integer "display_order"
    t.text "note"
    t.string "search_name"
    t.string "search_short_name"
    t.string "search_kana"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["jlac_code"], name: "index_master_lab_order_items_on_jlac_code"
    t.index ["kind"], name: "index_master_lab_order_items_on_kind"
    t.index ["order_item_code"], name: "index_master_lab_order_items_on_order_item_code", unique: true
  end

  create_table "master_lab_panel_items", force: :cascade do |t|
    t.string "panel_item_code", null: false
    t.string "member_item_code", null: false
    t.integer "display_order"
    t.string "member_type", default: "required", null: false
    t.text "note"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["member_item_code"], name: "index_master_lab_panel_items_on_member_item_code"
    t.index ["panel_item_code", "member_item_code"], name: "index_lab_panel_items_on_panel_and_member", unique: true
  end

  create_table "master_lab_specimens", force: :cascade do |t|
    t.string "specimen_code", null: false
    t.string "name", null: false
    t.string "short_name"
    t.string "category"
    t.string "parent_specimen_code"
    t.boolean "recommended", default: false, null: false
    t.string "jlac10_specimen_code"
    t.string "default_container_code"
    t.integer "display_order"
    t.string "name_kana"
    t.text "note"
    t.string "search_name"
    t.string "search_kana"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["parent_specimen_code"], name: "index_master_lab_specimens_on_parent_specimen_code"
    t.index ["specimen_code"], name: "index_master_lab_specimens_on_specimen_code", unique: true
  end

  create_table "master_medical_materials", force: :cascade do |t|
    t.string "change_category"
    t.string "master_type"
    t.string "material_code", null: false
    t.integer "name_kanji_length"
    t.string "name"
    t.integer "name_kana_length"
    t.string "name_kana"
    t.string "unit_code"
    t.integer "unit_name_length"
    t.string "unit_name"
    t.string "price_type"
    t.decimal "price", precision: 13, scale: 2
    t.string "reserve1"
    t.string "age_addition_category"
    t.string "lower_age_limit"
    t.string "upper_age_limit"
    t.string "reserve2"
    t.string "reserve3"
    t.string "name_change_flag"
    t.string "kana_change_flag"
    t.string "oxygen_category"
    t.string "material_category"
    t.string "price_cap_flag"
    t.string "price_cap_points"
    t.string "reserve4"
    t.string "publication_order"
    t.string "abolition_related_code"
    t.string "changed_on"
    t.string "transitional_measure_on"
    t.string "abolished_on"
    t.string "notification_table_number"
    t.string "notification_section_number"
    t.string "dpc_category"
    t.string "reserve5"
    t.string "reserve6"
    t.string "reserve7"
    t.string "basic_name"
    t.string "remanufactured_single_use_device"
    t.string "search_name"
    t.string "search_kana"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["abolished_on"], name: "index_master_medical_materials_on_abolished_on"
    t.index ["material_code"], name: "index_master_medical_materials_on_material_code", unique: true
    t.index ["name"], name: "index_master_medical_materials_on_name"
  end

  create_table "master_medical_procedures", force: :cascade do |t|
    t.string "change_category"
    t.string "master_type"
    t.string "procedure_code", null: false
    t.integer "name_kanji_length"
    t.string "name"
    t.integer "name_kana_length"
    t.string "name_kana"
    t.string "data_standard_code"
    t.integer "data_standard_name_length"
    t.string "data_standard_name"
    t.string "point_type"
    t.decimal "points", precision: 10, scale: 2
    t.string "inpatient_outpatient_category"
    t.string "elderly_category"
    t.string "point_column_outpatient"
    t.string "bundled_test"
    t.string "reserve1"
    t.string "dpc_category"
    t.string "hospital_clinic_category"
    t.string "image_surgery_support_category"
    t.string "medical_observation_act_category"
    t.string "nursing_addition"
    t.string "anesthesia_category"
    t.string "reserve2"
    t.string "disease_relation_category"
    t.string "reserve3"
    t.string "actual_days"
    t.string "days_or_times"
    t.string "medicine_relation_category"
    t.string "increment_calc_type"
    t.string "increment_lower_limit"
    t.string "increment_upper_limit"
    t.string "increment_value"
    t.decimal "increment_points", precision: 10, scale: 2
    t.string "increment_error_handling"
    t.string "max_times"
    t.string "max_times_error_handling"
    t.string "note_addition_code"
    t.string "note_addition_serial"
    t.string "general_rule_age"
    t.string "lower_age_limit"
    t.string "upper_age_limit"
    t.string "time_addition_category"
    t.string "standard_conformity_category"
    t.string "target_facility_standard"
    t.string "treatment_infant_addition_category"
    t.string "very_low_birth_weight_addition_category"
    t.string "admission_fee_reduction_target"
    t.string "donor_aggregation_category"
    t.string "test_judgment_category"
    t.string "test_judgment_group_category"
    t.string "degression_target_category"
    t.string "spinal_evoked_potential_addition_category"
    t.string "neck_dissection_addition_category"
    t.string "auto_suture_addition_category"
    t.string "outpatient_management_addition_category"
    t.string "reserve4"
    t.string "reserve5"
    t.string "name_change_flag"
    t.string "kana_change_flag"
    t.string "lab_test_comment"
    t.string "general_rule_addition_target_category"
    t.string "bundled_degression_category"
    t.string "endoscopic_ultrasound_addition_category"
    t.string "reserve6"
    t.string "point_column_inpatient"
    t.string "auto_anastomosis_addition_category"
    t.string "notification_category_1"
    t.string "notification_category_2"
    t.string "regional_addition"
    t.string "bed_count_category"
    t.string "facility_standard_code_1"
    t.string "facility_standard_code_2"
    t.string "facility_standard_code_3"
    t.string "facility_standard_code_4"
    t.string "facility_standard_code_5"
    t.string "facility_standard_code_6"
    t.string "facility_standard_code_7"
    t.string "facility_standard_code_8"
    t.string "facility_standard_code_9"
    t.string "facility_standard_code_10"
    t.string "ultrasonic_coagulation_addition_category"
    t.string "short_stay_surgery"
    t.string "dental_category"
    t.string "code_table_number_alpha"
    t.string "notification_number_alpha"
    t.string "changed_on"
    t.string "abolished_on"
    t.string "publication_order"
    t.string "code_table_chapter"
    t.string "code_table_part"
    t.string "code_table_section"
    t.string "code_table_branch"
    t.string "code_table_item"
    t.string "notification_chapter"
    t.string "notification_part"
    t.string "notification_section"
    t.string "notification_branch"
    t.string "notification_item"
    t.string "age_addition_lower_age_1"
    t.string "age_addition_upper_age_1"
    t.string "age_addition_procedure_code_1"
    t.string "age_addition_lower_age_2"
    t.string "age_addition_upper_age_2"
    t.string "age_addition_procedure_code_2"
    t.string "age_addition_lower_age_3"
    t.string "age_addition_upper_age_3"
    t.string "age_addition_procedure_code_3"
    t.string "age_addition_lower_age_4"
    t.string "age_addition_upper_age_4"
    t.string "age_addition_procedure_code_4"
    t.string "reserve7"
    t.string "basic_name"
    t.string "sinus_endoscope_addition"
    t.string "sinus_bone_tissue_resection_addition"
    t.string "long_anesthesia_management_addition"
    t.string "point_table_section_number"
    t.string "monitoring_addition"
    t.string "cryopreserved_tissue_addition"
    t.string "malignant_tumor_pathology_addition"
    t.string "external_fixator_addition"
    t.string "ultrasonic_cutting_addition"
    t.string "laa_closure_addition"
    t.string "outpatient_infection_control_addition"
    t.string "ent_infant_treatment_addition"
    t.string "ent_pediatric_antimicrobial_addition"
    t.string "npwt_device_addition"
    t.string "nursing_staff_treatment_improvement"
    t.string "outpatient_home_base_up_1"
    t.string "outpatient_home_base_up_2"
    t.string "remanufactured_single_use_device_addition"
    t.string "price_response_category"
    t.string "price_response_group_category"
    t.string "organ_transplant_system_addition"
    t.string "endoscopic_surgery_support_device_addition"
    t.string "remote_e_prescription_addition"
    t.string "surgical_care_special_addition"
    t.string "reserve8"
    t.string "reserve9"
    t.string "reserve10"
    t.string "reserve11"
    t.string "reserve12"
    t.string "reserve13"
    t.string "reserve14"
    t.string "reserve15"
    t.string "reserve16"
    t.string "reserve17"
    t.string "reserve18"
    t.string "reserve19"
    t.string "reserve20"
    t.string "search_name"
    t.string "search_kana"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["abolished_on"], name: "index_master_medical_procedures_on_abolished_on"
    t.index ["code_table_number_alpha"], name: "index_master_medical_procedures_on_code_table_number_alpha"
    t.index ["name"], name: "index_master_medical_procedures_on_name"
    t.index ["procedure_code"], name: "index_master_medical_procedures_on_procedure_code", unique: true
  end

  create_table "master_medicine_dose_conversions", force: :cascade do |t|
    t.string "medicine_code", null: false
    t.string "from_unit", null: false
    t.decimal "factor", precision: 16, scale: 6, null: false
    t.string "to_unit", null: false
    t.string "source", null: false
    t.boolean "needs_review", default: false, null: false
    t.text "note"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["medicine_code", "from_unit"], name: "index_medicine_dose_conversions_on_code_and_from_unit", unique: true
    t.index ["needs_review"], name: "index_master_medicine_dose_conversions_on_needs_review"
  end

  create_table "master_medicine_types", force: :cascade do |t|
    t.string "code", null: false
    t.string "name"
    t.string "search_name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_master_medicine_types_on_code", unique: true
  end

  create_table "master_medicine_usages", force: :cascade do |t|
    t.string "usage_code", null: false
    t.string "basic_usage_category_code"
    t.string "basic_usage_category"
    t.string "detailed_usage_category_code"
    t.string "detailed_usage_category"
    t.string "timing_category_code"
    t.string "timing_category"
    t.string "usage_name"
    t.string "standard_usage_number"
    t.string "start_date"
    t.string "end_date"
    t.string "usage_code_category"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "search_name"
    t.index ["usage_code"], name: "index_master_medicine_usages_on_usage_code", unique: true
    t.index ["usage_name"], name: "index_master_medicine_usages_on_usage_name"
  end

  create_table "master_medicines", force: :cascade do |t|
    t.string "change_category"
    t.string "master_type"
    t.string "medicine_code", null: false
    t.integer "name_kanji_length"
    t.string "name"
    t.integer "name_kana_length"
    t.string "name_kana"
    t.string "unit_code"
    t.integer "unit_name_length"
    t.string "unit_name"
    t.string "price_type"
    t.decimal "price", precision: 13, scale: 2
    t.string "reserve1"
    t.string "narcotic_category"
    t.string "nerve_destruction_flag"
    t.string "biological_product_flag"
    t.string "generic_flag"
    t.string "reserve2"
    t.string "dental_specific_flag"
    t.string "contrast_medium_category"
    t.string "injection_volume"
    t.string "listing_method_category"
    t.string "brand_name_related_code"
    t.string "old_price_type"
    t.decimal "old_price", precision: 13, scale: 2
    t.string "name_change_flag"
    t.string "kana_change_flag"
    t.string "dosage_form"
    t.string "reserve3"
    t.string "changed_on"
    t.string "abolished_on"
    t.string "yakka_code"
    t.string "publication_order"
    t.string "transitional_measure_on"
    t.string "basic_name"
    t.string "listed_on"
    t.string "generic_name_code"
    t.string "generic_name_description"
    t.string "generic_name_addition_category"
    t.string "anti_hiv_flag"
    t.string "long_term_listed_related_code"
    t.string "selective_treatment_category"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "search_name"
    t.string "search_kana"
    t.string "search_generic"
    t.index ["generic_name_code"], name: "index_master_medicines_on_generic_name_code"
    t.index ["medicine_code"], name: "index_master_medicines_on_medicine_code", unique: true
    t.index ["name"], name: "index_master_medicines_on_name"
    t.index ["yakka_code"], name: "index_master_medicines_on_yakka_code"
  end

  create_table "master_micro_antimicrobials", force: :cascade do |t|
    t.string "code", null: false
    t.string "name", null: false
    t.string "abbreviation"
    t.string "brand_name"
    t.string "category"
    t.boolean "frequent", default: false, null: false
    t.string "source", default: "official", null: false
    t.integer "display_order"
    t.string "search_name"
    t.string "search_abbreviation"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_master_micro_antimicrobials_on_code", unique: true
    t.index ["search_abbreviation"], name: "index_master_micro_antimicrobials_on_search_abbreviation"
    t.index ["search_name"], name: "index_master_micro_antimicrobials_on_search_name"
  end

  create_table "master_micro_collection_methods", force: :cascade do |t|
    t.string "code", null: false
    t.string "name", null: false
    t.integer "display_order"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_master_micro_collection_methods_on_code", unique: true
  end

  create_table "master_micro_collection_sites", force: :cascade do |t|
    t.string "code", null: false
    t.string "name", null: false
    t.boolean "laterality_applicable", default: false, null: false
    t.integer "display_order"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_master_micro_collection_sites_on_code", unique: true
  end

  create_table "master_micro_order_items", force: :cascade do |t|
    t.string "item_code", null: false
    t.string "name", null: false
    t.string "short_name"
    t.integer "display_order"
    t.date "valid_from"
    t.date "valid_to"
    t.string "receipt_code"
    t.string "note"
    t.string "search_name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["item_code"], name: "index_master_micro_order_items_on_item_code", unique: true
  end

  create_table "master_micro_organisms", force: :cascade do |t|
    t.string "code", null: false
    t.string "name", null: false
    t.boolean "frequent", default: false, null: false
    t.string "source", default: "official", null: false
    t.integer "display_order"
    t.string "search_name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_master_micro_organisms_on_code", unique: true
    t.index ["search_name"], name: "index_master_micro_organisms_on_search_name"
  end

  create_table "master_micro_specimen_types", force: :cascade do |t|
    t.string "code", null: false
    t.string "name", null: false
    t.string "category"
    t.string "source", default: "official", null: false
    t.integer "display_order"
    t.string "search_name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_master_micro_specimen_types_on_code", unique: true
    t.index ["search_name"], name: "index_master_micro_specimen_types_on_search_name"
  end

  create_table "master_micro_susceptibility_methods", force: :cascade do |t|
    t.string "code", null: false
    t.string "name", null: false
    t.string "classification"
    t.string "product_name"
    t.string "company"
    t.string "note"
    t.string "source", default: "official", null: false
    t.integer "display_order"
    t.string "search_name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_master_micro_susceptibility_methods_on_code", unique: true
    t.index ["search_name"], name: "index_master_micro_susceptibility_methods_on_search_name"
  end

  create_table "master_modifiers", force: :cascade do |t|
    t.string "change_category"
    t.string "management_number", null: false
    t.string "name", null: false
    t.string "name_kana"
    t.string "exchange_code"
    t.string "connection_position_category"
    t.string "modifier_category"
    t.string "exclusive_group_code"
    t.string "receipt_code"
    t.string "description_label"
    t.string "search_name"
    t.string "search_kana"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["exchange_code"], name: "index_master_modifiers_on_exchange_code"
    t.index ["management_number"], name: "index_master_modifiers_on_management_number", unique: true
  end

  create_table "master_rad_item_layout_cells", force: :cascade do |t|
    t.integer "layout_id", null: false
    t.integer "grid_row", null: false
    t.integer "grid_column", null: false
    t.string "cell_type", default: "item", null: false
    t.string "item_code"
    t.string "display_name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["item_code"], name: "index_master_rad_item_layout_cells_on_item_code"
    t.index ["layout_id", "grid_row", "grid_column"], name: "index_rad_layout_cells_on_layout_and_position", unique: true
  end

  create_table "master_rad_item_layouts", force: :cascade do |t|
    t.string "name", null: false
    t.integer "row_count", default: 10, null: false
    t.integer "column_count", default: 5, null: false
    t.integer "display_order"
    t.boolean "active", default: true, null: false
    t.text "note"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["name"], name: "index_master_rad_item_layouts_on_name", unique: true
  end

  create_table "master_rad_items", force: :cascade do |t|
    t.string "item_code", null: false
    t.string "name", null: false
    t.string "short_name"
    t.string "name_kana"
    t.string "kind", default: "single", null: false
    t.string "modality_code"
    t.string "procedure_major_code"
    t.string "procedure_minor_code"
    t.string "procedure_extension_code"
    t.string "body_part_code"
    t.string "laterality_code"
    t.string "body_position_code"
    t.string "direction_code"
    t.string "detail_position_code"
    t.string "special_instruction_code"
    t.string "nuclide_code"
    t.string "generic_extension_code"
    t.string "jj1017_code"
    t.date "valid_from"
    t.date "valid_to"
    t.string "receipt_code"
    t.integer "display_order"
    t.text "note"
    t.string "search_name"
    t.string "search_short_name"
    t.string "search_kana"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "purpose_template_canonical"
    t.string "remarks_template_canonical"
    t.boolean "groupable", default: true, null: false
    t.index ["groupable"], name: "index_master_rad_items_on_groupable"
    t.index ["item_code"], name: "index_master_rad_items_on_item_code", unique: true
    t.index ["jj1017_code"], name: "index_master_rad_items_on_jj1017_code"
    t.index ["kind"], name: "index_master_rad_items_on_kind"
    t.index ["modality_code"], name: "index_master_rad_items_on_modality_code"
  end

  create_table "master_rad_jj1017_codes", force: :cascade do |t|
    t.string "element", null: false
    t.string "code", null: false
    t.string "name", null: false
    t.string "name_english"
    t.string "common_name"
    t.string "jj_version"
    t.text "note"
    t.string "source", default: "official", null: false
    t.integer "display_order"
    t.string "major_part_code"
    t.string "organ_system_code"
    t.boolean "use_general", default: false, null: false
    t.boolean "use_ct", default: false, null: false
    t.boolean "use_mr", default: false, null: false
    t.boolean "use_us", default: false, null: false
    t.string "search_name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["element", "code"], name: "index_rad_jj1017_codes_on_element_and_code", unique: true
    t.index ["search_name"], name: "index_master_rad_jj1017_codes_on_search_name"
  end

  create_table "master_rad_jj1017_frequent_codes", force: :cascade do |t|
    t.string "category", null: false
    t.string "jj1017_code", null: false
    t.string "name", null: false
    t.integer "display_order"
    t.string "search_name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["category", "jj1017_code"], name: "index_rad_frequent_codes_on_category_and_code", unique: true
    t.index ["search_name"], name: "index_master_rad_jj1017_frequent_codes_on_search_name"
  end

  create_table "master_rad_materials", force: :cascade do |t|
    t.string "material_code", null: false
    t.string "name", null: false
    t.string "name_kana"
    t.string "maker"
    t.string "model_number"
    t.string "receipt_material_code"
    t.string "unit_name"
    t.date "valid_from"
    t.date "valid_to"
    t.integer "display_order"
    t.text "note"
    t.string "search_name"
    t.string "search_kana"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["material_code"], name: "index_master_rad_materials_on_material_code", unique: true
    t.index ["receipt_material_code"], name: "index_master_rad_materials_on_receipt_material_code"
  end

  create_table "master_rad_set_items", force: :cascade do |t|
    t.string "set_item_code", null: false
    t.string "member_item_code", null: false
    t.integer "display_order"
    t.text "note"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["member_item_code"], name: "index_master_rad_set_items_on_member_item_code"
    t.index ["set_item_code", "member_item_code"], name: "index_rad_set_items_on_set_and_member", unique: true
  end

  create_table "master_schema_categories", force: :cascade do |t|
    t.string "name", null: false
    t.bigint "parent_id"
    t.integer "display_order"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["parent_id"], name: "index_master_schema_categories_on_parent_id"
  end

  create_table "master_schemas", force: :cascade do |t|
    t.string "name", null: false
    t.bigint "category_id"
    t.text "image", null: false
    t.text "thumbnail", null: false
    t.integer "display_order"
    t.text "note"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["category_id"], name: "index_master_schemas_on_category_id"
  end

  create_table "questionnaire_categories", force: :cascade do |t|
    t.string "code", null: false
    t.string "name", null: false
    t.integer "display_order", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_questionnaire_categories_on_code", unique: true
    t.index ["name"], name: "index_questionnaire_categories_on_name", unique: true
  end

  create_table "report_layouts", force: :cascade do |t|
    t.string "name", null: false
    t.string "questionnaire_url", null: false
    t.string "questionnaire_version", default: "", null: false
    t.text "tlf", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "mapping", default: "", null: false
    t.index ["questionnaire_url", "questionnaire_version"], name: "index_report_layouts_on_canonical", unique: true
  end

  create_table "users", force: :cascade do |t|
    t.string "login_id", null: false
    t.string "password_digest", null: false
    t.string "practitioner_fhir_id", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["login_id"], name: "index_users_on_login_id", unique: true
    t.index ["practitioner_fhir_id"], name: "index_users_on_practitioner_fhir_id", unique: true
  end
end
