# This file should contain all the record creation needed to seed the database with its default values.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).
#
# Examples:
#
#   movies = Movie.create([{ name: "Star Wars" }, { name: "Lord of the Rings" }])
#   Character.create(name: "Luke", movie: movies.first)

# 薬効分類マスタ（日本標準商品分類「87」細分類, 4桁 → 名称）。
# db/seed_data/medicine_types.csv（ヘッダー無し, code,name）から投入する。
# 名称が空の行（一次情報で未確認のコード）はスキップする。
require "csv"

medicine_types_csv = Rails.root.join("db/seed_data/medicine_types.csv")
if File.exist?(medicine_types_csv)
  loaded = 0
  CSV.foreach(medicine_types_csv) do |row|
    code = row[0].to_s.strip
    name = row[1].to_s.strip
    next if code.blank? || name.blank?

    record = Master::MedicineType.find_or_initialize_by(code: code)
    record.name = name
    record.save!
    loaded += 1
  end
  puts "master_medicine_types: seeded #{loaded} rows"
else
  puts "master_medicine_types: #{medicine_types_csv} not found, skipped"
end
