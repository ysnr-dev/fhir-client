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

ActiveRecord::Schema[7.0].define(version: 2026_07_19_134304) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "plpgsql"

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
    t.index ["generic_name_code"], name: "index_master_medicines_on_generic_name_code"
    t.index ["medicine_code"], name: "index_master_medicines_on_medicine_code", unique: true
    t.index ["name"], name: "index_master_medicines_on_name"
    t.index ["yakka_code"], name: "index_master_medicines_on_yakka_code"
  end

end
