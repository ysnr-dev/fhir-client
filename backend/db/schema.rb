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

ActiveRecord::Schema[8.0].define(version: 2026_08_01_000000) do
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
    t.index ["fhir_item_name"], name: "index_master_lab_items_on_fhir_item_name"
    t.index ["jlac10_code"], name: "index_master_lab_items_on_jlac10_code"
    t.index ["jlac11_code"], name: "index_master_lab_items_on_jlac11_code", unique: true
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
end
