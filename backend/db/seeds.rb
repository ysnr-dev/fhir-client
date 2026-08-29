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

# JJ1017 の部品コードのうち、配布 Excel の別表に無いもの。
# db/seed_data/rad_jj1017_codes.csv（ヘッダー有り）から投入する。
#   - 種別(モダリティ)と左右等は指針本文の表5.2 / 表5.5 にしかコード表が無い
#   - 手元の配布別表は Ver3.3 のため、Ver3.4 で追加されたコードをここで補う
# source=official として入れるので、別表の取込（洗い替え）で消える。
# 別表A を取り込み直したときは db:seed を再実行すること。
# 細菌検査オーダーの独自マスタ3種(検査項目・採取部位・採取方法)。
# いずれも施設で直す前提の初期値なので、既存行は上書きしない。
{
  "micro_order_items" => [Master::MicroOrderItem, :item_code, lambda { |row|
    {
      item_code: row["item_code"].to_s.strip,
      name: row["name"].to_s.strip,
      short_name: row["short_name"].to_s.strip.presence,
      display_order: row["display_order"].to_s.strip.presence&.to_i
    }
  }],
  "micro_collection_sites" => [Master::MicroCollectionSite, :code, lambda { |row|
    {
      code: row["code"].to_s.strip,
      name: row["name"].to_s.strip,
      laterality_applicable: row["laterality_applicable"].to_s.strip == "1",
      display_order: row["display_order"].to_s.strip.presence&.to_i
    }
  }],
  "micro_collection_methods" => [Master::MicroCollectionMethod, :code, lambda { |row|
    {
      code: row["code"].to_s.strip,
      name: row["name"].to_s.strip,
      display_order: row["display_order"].to_s.strip.presence&.to_i
    }
  }],
  # 病理検査オーダーのマスタ2種。JAHIS 病理・臨床細胞データ交換規約 Ver.2.1C の
  # 付録-3 サンプルマスタ(LPATHO003 臓器・検査材料 / LPATHO004 採取法)。
  # 臓器は source=official(モデルの既定値)のまま入り、画面からは頻用の印だけを直せる。
  "patho_organs" => [Master::PathoOrgan, :code, lambda { |row|
    {
      code: row["code"].to_s.strip,
      name: row["name"].to_s.strip,
      icd10: row["icd10"].to_s.strip.presence,
      display_order: row["display_order"].to_s.strip.presence&.to_i
    }
  }],
  "patho_collection_methods" => [Master::PathoCollectionMethod, :code, lambda { |row|
    {
      code: row["code"].to_s.strip,
      name: row["name"].to_s.strip,
      display_order: row["display_order"].to_s.strip.presence&.to_i
    }
  }]
}.each do |basename, (model, key_column, build)|
  csv_path = Rails.root.join("db/seed_data/#{basename}.csv")
  unless File.exist?(csv_path)
    puts "#{model.table_name}: #{csv_path} not found, skipped"
    next
  end

  loaded = 0
  kept = 0
  CSV.foreach(csv_path, headers: true) do |row|
    attrs = build.call(row)
    next if attrs[key_column].blank? || attrs[:name].blank?

    if model.exists?(key_column => attrs[key_column])
      kept += 1
      next
    end

    model.create!(attrs)
    loaded += 1
  end
  puts "#{model.table_name}: seeded #{loaded} rows (kept #{kept})"
end

# 頻用菌(細菌検査オーダーの目的菌欄にチェックボックスで直接並べる菌)の初期セット。
# db/seed_data/micro_frequent_organisms.csv（ヘッダー有り, code,name,category）の
# JANIS 病原体コードに frequent を立てる。name/category は人が読むための欄で、
# 突き合わせはコードだけで行う（名称がずれていれば警告して印は立てる）。
# 菌マスタ(JANIS 配布ファイル)が未取込だとコードが無いのでスキップされる。
# 取込後に db:seed を再実行すると反映される。
# 既に立っている印は触らず、印を消した菌は再実行で戻る（他のマスタと同じく初期値の投入）。
frequent_csv = Rails.root.join("db/seed_data/micro_frequent_organisms.csv")
if File.exist?(frequent_csv)
  marked = 0
  kept = 0
  missing = []
  CSV.foreach(frequent_csv, headers: true) do |row|
    code = row["code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank?

    organism = Master::MicroOrganism.find_by(code: code)
    if organism.nil?
      missing << code
      next
    end

    if name.present? && organism.name != name
      puts "master_micro_organisms: code #{code} の菌名が CSV と違います (#{organism.name.inspect})"
    end

    if organism.frequent?
      kept += 1
    else
      organism.update!(frequent: true)
      marked += 1
    end
  end
  puts "master_micro_organisms frequent: marked #{marked} rows " \
       "(kept #{kept}, organism not imported #{missing.size}#{missing.empty? ? '' : ": #{missing.join(', ')}"})"
else
  puts "master_micro_organisms frequent: #{frequent_csv} not found, skipped"
end

# 頻用抗菌薬(細菌検査結果の薬剤感受性欄に直接並べる薬)の初期セット。
# db/seed_data/micro_frequent_antimicrobials.csv（ヘッダー有り, code,name,abbreviation）の
# JANIS 抗菌薬コードに frequent を立てる。name/abbreviation は人が読むための欄で、
# 突き合わせはコードだけで行う（名称がずれていれば警告して印は立てる）。
# 抗菌薬マスタ(JANIS 配布ファイル)が未取込だとコードが無いのでスキップされる。
# 取込後に db:seed を再実行すると反映される。
frequent_drug_csv = Rails.root.join("db/seed_data/micro_frequent_antimicrobials.csv")
if File.exist?(frequent_drug_csv)
  marked = 0
  kept = 0
  missing = []
  CSV.foreach(frequent_drug_csv, headers: true) do |row|
    code = row["code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank?

    drug = Master::MicroAntimicrobial.find_by(code: code)
    if drug.nil?
      missing << code
      next
    end

    if name.present? && drug.name != name
      puts "master_micro_antimicrobials: code #{code} の薬剤名が CSV と違います (#{drug.name.inspect})"
    end

    if drug.frequent?
      kept += 1
    else
      drug.update!(frequent: true)
      marked += 1
    end
  end
  puts "master_micro_antimicrobials frequent: marked #{marked} rows " \
       "(kept #{kept}, antimicrobial not imported #{missing.size}#{missing.empty? ? '' : ": #{missing.join(', ')}"})"
else
  puts "master_micro_antimicrobials frequent: #{frequent_drug_csv} not found, skipped"
end

rad_codes_csv = Rails.root.join("db/seed_data/rad_jj1017_codes.csv")
if File.exist?(rad_codes_csv)
  loaded = 0
  # 掲載順は要素ごとの現在の最大値の後ろに積む。Ver3.4 の追加コードが、取込済みの
  # 別表(Ver3.3)の並びの末尾に付くようにするため。
  order_by_element = Master::RadJj1017Code.group(:element).maximum(:display_order)
  order_by_element.default = 0
  CSV.foreach(rad_codes_csv, headers: true) do |row|
    element = row["element"].to_s.strip
    code = row["code"].to_s.strip
    name = row["name"].to_s.strip
    next if element.blank? || code.blank? || name.blank?

    record = Master::RadJj1017Code.find_or_initialize_by(element: element, code: code)
    order_by_element[element] = (order_by_element[element] || 0) + 10 if record.new_record?
    record.assign_attributes(
      name: name,
      name_english: row["name_english"].to_s.strip.presence,
      common_name: row["common_name"].to_s.strip.presence,
      jj_version: row["jj_version"].to_s.strip.presence,
      note: row["note"].to_s.strip.presence,
      source: Master::RadJj1017Code::OFFICIAL,
      display_order: record.display_order || order_by_element[element]
    )
    record.save!
    loaded += 1
  end
  puts "master_rad_jj1017_codes: seeded #{loaded} rows"
else
  puts "master_rad_jj1017_codes: #{rad_codes_csv} not found, skipped"
end

# 生理検査の検査種別マスタ。db/seed_data/physio_exam_types.csv（ヘッダー無し,
# exam_type_code,name,short_name,name_kana,display_order）から投入する。
# 生理検査は JJ1017 に収載されておらず配布マスタも無いので、放射線のモダリティに
# 当たる分類はここで初期値を用意する。粒度は施設で変わるため、投入後は画面で
# 直す前提。既存行は上書きしない（施設で直した内容を消さない）。
physio_exam_types_csv = Rails.root.join("db/seed_data/physio_exam_types.csv")
if File.exist?(physio_exam_types_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(physio_exam_types_csv) do |row|
    code = row[0].to_s.strip
    name = row[1].to_s.strip
    next if code.blank? || name.blank?

    if Master::PhysioExamType.exists?(exam_type_code: code)
      skipped += 1
      next
    end

    Master::PhysioExamType.create!(
      exam_type_code: code,
      name: name,
      short_name: row[2].to_s.strip.presence,
      name_kana: row[3].to_s.strip.presence,
      display_order: row[4].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_physio_exam_types: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_physio_exam_types: #{physio_exam_types_csv} not found, skipped"
end

# 内視鏡の検査種別マスタ。db/seed_data/endoscopy_exam_types.csv（ヘッダー無し,
# exam_type_code,name,short_name,name_kana,display_order,jed_exam_category）から
# 投入する。JED(Japan Endoscopy Database)の4区分(上部・小腸・下部・ERCP)を
# 初期値とし、JED 対象外の気管支鏡も施設追加の例として含める。粒度は施設で
# 変わるため、投入後は画面で直す前提。既存行は上書きしない（施設で直した内容を
# 消さない）。
endoscopy_exam_types_csv = Rails.root.join("db/seed_data/endoscopy_exam_types.csv")
if File.exist?(endoscopy_exam_types_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(endoscopy_exam_types_csv) do |row|
    code = row[0].to_s.strip
    name = row[1].to_s.strip
    next if code.blank? || name.blank?

    if Master::EndoscopyExamType.exists?(exam_type_code: code)
      skipped += 1
      next
    end

    Master::EndoscopyExamType.create!(
      exam_type_code: code,
      name: name,
      short_name: row[2].to_s.strip.presence,
      name_kana: row[3].to_s.strip.presence,
      display_order: row[4].to_s.strip.presence&.to_i,
      jed_exam_category: row[5].to_s.strip.presence
    )
    loaded += 1
  end
  puts "master_endoscopy_exam_types: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_endoscopy_exam_types: #{endoscopy_exam_types_csv} not found, skipped"
end
