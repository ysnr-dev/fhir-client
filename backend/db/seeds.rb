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

# 採取管マスタ。db/seed_data/lab_containers.csv（ヘッダー無し,
# container_code,name,short_name,cap_color,additive,capacity,display_order）から投入する。
# 採取管の呼称・色は施設で変わるため、投入後は画面で直す前提の初期値。
# 既存行は上書きしない（施設で直した内容を消さない）。
containers_csv = Rails.root.join("db/seed_data/lab_containers.csv")
if File.exist?(containers_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(containers_csv) do |row|
    code = row[0].to_s.strip
    name = row[1].to_s.strip
    next if code.blank? || name.blank?

    if Master::LabContainer.exists?(container_code: code)
      skipped += 1
      next
    end

    Master::LabContainer.create!(
      container_code: code,
      name: name,
      short_name: row[2].to_s.strip.presence,
      cap_color: row[3].to_s.strip.presence,
      additive: row[4].to_s.strip.presence,
      capacity: row[5].to_s.strip.presence,
      display_order: row[6].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_lab_containers: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_lab_containers: #{containers_csv} not found, skipped"
end

# 検体 → 既定採取管の紐付け。db/seed_data/lab_specimen_default_containers.csv
# （ヘッダー無し, specimen_code,container_code）から、取込済みの検体マスタに
# 既定採取管を設定する。設定済みの行は上書きしない。検体マスタ未取込の
# コードはスキップされるので、取込後に db:seed を再実行すると反映される。
defaults_csv = Rails.root.join("db/seed_data/lab_specimen_default_containers.csv")
if File.exist?(defaults_csv)
  loaded = 0
  missing = 0
  kept = 0
  CSV.foreach(defaults_csv) do |row|
    specimen_code = row[0].to_s.strip
    container_code = row[1].to_s.strip
    next if specimen_code.blank? || container_code.blank?

    specimen = Master::LabSpecimen.find_by(specimen_code: specimen_code)
    if specimen.nil?
      missing += 1
    elsif specimen.default_container_code.present?
      kept += 1
    else
      specimen.update!(default_container_code: container_code)
      loaded += 1
    end
  end
  puts "master_lab_specimens defaults: set #{loaded} rows (kept #{kept}, specimen not imported #{missing})"
else
  puts "master_lab_specimens defaults: #{defaults_csv} not found, skipped"
end
