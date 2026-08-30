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

# 術式の種別(分類)マスタ。db/seed_data/surgery_categories.csv（ヘッダー無し,
# category_code,parent_code,name,name_kana,display_order）から投入する。
# 医科点数表 第2章第10部 手術 第1節 手術料 の「第1款〜第11款」と、その中の
# 部位区分を初期値とする(親が先に並んでいる前提。子から先に入れると親が無くて
# 落ちる)。分類名は改定で変わりうるうえ、施設によって使う深さも違うので、投入後は
# 画面で直す前提。既存行は上書きしない（施設で直した内容を消さない）。
surgery_categories_csv = Rails.root.join("db/seed_data/surgery_categories.csv")
if File.exist?(surgery_categories_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(surgery_categories_csv) do |row|
    code = row[0].to_s.strip
    name = row[2].to_s.strip
    next if code.blank? || name.blank?

    if Master::SurgeryCategory.exists?(category_code: code)
      skipped += 1
      next
    end

    Master::SurgeryCategory.create!(
      category_code: code,
      parent_code: row[1].to_s.strip.presence,
      name: name,
      name_kana: row[3].to_s.strip.presence,
      display_order: row[4].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_surgery_categories: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_surgery_categories: #{surgery_categories_csv} not found, skipped"
end

# 術式マスタ。db/seed_data/surgery_items.csv（ヘッダー有り）から投入する。
# 一般病院で使う代表的な術式を診療科ごとに拾った初期値で、点数表 K 章の名称・
# レセ電算コードをそのまま使う。item_code はレセ電算コード(9桁)と同じにしてある。
#   - 施設独自採番(000001 のような連番)とぶつからない
#   - 再投入しても同じ行を指すので、追加分だけが入る
# 既定値(所要時間・到達法・体位・麻酔方法)と左右必須は施設の運用で変わるので、
# 投入後は画面で直す前提。既存行は上書きしない（施設で直した内容を消さない）。
# 種別(category_code)は surgery_categories.csv の分類コードを指す。
surgery_items_csv = Rails.root.join("db/seed_data/surgery_items.csv")
if File.exist?(surgery_items_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(surgery_items_csv, headers: true) do |row|
    code = row["item_code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank? || name.blank?

    if Master::SurgeryItem.exists?(item_code: code)
      skipped += 1
      next
    end

    Master::SurgeryItem.create!(
      item_code: code,
      name: name,
      short_name: row["short_name"].to_s.strip.presence,
      name_kana: row["name_kana"].to_s.strip.presence,
      receipt_code: row["receipt_code"].to_s.strip.presence,
      category_code: row["category_code"].to_s.strip.presence,
      default_duration_minutes: row["default_duration_minutes"].to_s.strip.presence&.to_i,
      default_approach: row["default_approach"].to_s.strip.presence,
      default_position: row["default_position"].to_s.strip.presence,
      default_anesthesia_methods: row["default_anesthesia_methods"].to_s.strip.presence,
      requires_laterality: row["requires_laterality"].to_s.strip == "1",
      display_order: row["display_order"].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_surgery_items: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_surgery_items: #{surgery_items_csv} not found, skipped"
end

# 部門オーダー(生理検査・処置)の項目マスタ一式を CSV から投入する共通処理。
# どちらも「項目 → セット構成 → 実施入力データセット＋明細 → 伝票レイアウト」の
# 同型 4 テーブルなので、モデルと CSV の接頭辞だけ差し替えて使う。
#
#   #{prefix}_items.csv              (ヘッダー有り) item_code,name,short_name,name_kana,kind,
#                                    [exam_type_code,]receipt_code,dataset_code,
#                                    requires_perform_input,display_order
#   #{prefix}_set_items.csv          set_item_code,member_item_code,display_order
#   #{prefix}_datasets.csv           dataset_code,name,name_kana,display_order
#   #{prefix}_dataset_details.csv    dataset_code,detail_type,code,default_selected,display_order
#   #{prefix}_item_layout_cells.csv  layout_name,grid_row,grid_column,cell_type,item_code,display_name
#
# 共通の考え方:
#   - item_code はレセ電算コード(9桁)と同じにしてある(術式マスタと同じ理由: 施設独自採番と
#     ぶつからず、再投入で追加分だけ入る)。1つのレセ電算コードを複数の項目に分ける場合は
#     「コード-枝番」、セットは SET-nn(レセ電算コードを持たない)。
#   - 実施入力の手技明細はデータセットからしか展開されない(項目の receipt_code は実施時に
#     使わない)ので、項目ごとに自身の手技料を初期値ONで持つデータセットを添える。
#     dataset_code は receipt_code と同じで、枝番で分けた項目は同じデータセットを共有する。
#     薬剤・器材は施設で違うので入れない。明細は診療行為マスタの存在を確かめない
#     (未取込でも投入され、取込後に名称が出る)。
#   - 予約必須・所要時間・予約枠は施設の運用で決まるので初期値には入れない。
#   - 既存行は上書きしない。データセットは明細ごと、レイアウトは同名があればマスごと、
#     セット構成は行単位でスキップする(施設で直した内容を戻さない)。
seed_department_order_masters = lambda do |prefix, models|
  items_csv = Rails.root.join("db/seed_data/#{prefix}_items.csv")
  if File.exist?(items_csv)
    loaded = 0
    skipped = 0
    CSV.foreach(items_csv, headers: true) do |row|
      code = row["item_code"].to_s.strip
      name = row["name"].to_s.strip
      next if code.blank? || name.blank?

      if models[:item].exists?(item_code: code)
        skipped += 1
        next
      end

      attrs = {
        item_code: code,
        name: name,
        short_name: row["short_name"].to_s.strip.presence,
        name_kana: row["name_kana"].to_s.strip.presence,
        kind: row["kind"].to_s.strip.presence || "single",
        receipt_code: row["receipt_code"].to_s.strip.presence,
        dataset_code: row["dataset_code"].to_s.strip.presence,
        requires_perform_input: row["requires_perform_input"].to_s.strip != "0",
        display_order: row["display_order"].to_s.strip.presence&.to_i
      }
      # 検査種別は生理検査だけが持つ(処置の CSV には列が無い)。
      attrs[:exam_type_code] = row["exam_type_code"].to_s.strip.presence if row.include?("exam_type_code")
      models[:item].create!(attrs)
      loaded += 1
    end
    puts "#{models[:item].table_name}: seeded #{loaded} rows (kept #{skipped})"
  else
    puts "#{models[:item].table_name}: #{items_csv} not found, skipped"
  end

  set_items_csv = Rails.root.join("db/seed_data/#{prefix}_set_items.csv")
  if File.exist?(set_items_csv)
    loaded = 0
    skipped = 0
    CSV.foreach(set_items_csv, headers: true) do |row|
      set_code = row["set_item_code"].to_s.strip
      member_code = row["member_item_code"].to_s.strip
      next if set_code.blank? || member_code.blank?

      if models[:set_item].exists?(set_item_code: set_code, member_item_code: member_code)
        skipped += 1
        next
      end

      models[:set_item].create!(
        set_item_code: set_code,
        member_item_code: member_code,
        display_order: row["display_order"].to_s.strip.presence&.to_i
      )
      loaded += 1
    end
    puts "#{models[:set_item].table_name}: seeded #{loaded} rows (kept #{skipped})"
  else
    puts "#{models[:set_item].table_name}: #{set_items_csv} not found, skipped"
  end

  datasets_csv = Rails.root.join("db/seed_data/#{prefix}_datasets.csv")
  details_csv = Rails.root.join("db/seed_data/#{prefix}_dataset_details.csv")
  if File.exist?(datasets_csv) && File.exist?(details_csv)
    details_by_dataset = Hash.new { |h, k| h[k] = [] }
    CSV.foreach(details_csv, headers: true) do |row|
      dataset_code = row["dataset_code"].to_s.strip
      code = row["code"].to_s.strip
      next if dataset_code.blank? || code.blank?

      details_by_dataset[dataset_code] << {
        detail_type: row["detail_type"].to_s.strip,
        code: code,
        default_selected: row["default_selected"].to_s.strip != "0",
        display_order: row["display_order"].to_s.strip.presence&.to_i
      }
    end

    loaded = 0
    skipped = 0
    detail_count = 0
    CSV.foreach(datasets_csv, headers: true) do |row|
      code = row["dataset_code"].to_s.strip
      name = row["name"].to_s.strip
      next if code.blank? || name.blank?

      if models[:dataset].exists?(dataset_code: code)
        skipped += 1
        next
      end

      models[:dataset].transaction do
        models[:dataset].create!(
          dataset_code: code,
          name: name,
          name_kana: row["name_kana"].to_s.strip.presence,
          display_order: row["display_order"].to_s.strip.presence&.to_i
        )
        details_by_dataset[code].each do |detail|
          models[:dataset_detail].create!(detail.merge(dataset_code: code))
          detail_count += 1
        end
      end
      loaded += 1
    end
    puts "#{models[:dataset].table_name}: seeded #{loaded} rows with #{detail_count} details (kept #{skipped})"
  else
    puts "#{models[:dataset].table_name}: #{datasets_csv} or #{details_csv} not found, skipped"
  end

  # レイアウトは layout_name ごとに作り、行数・列数はマスの最大位置から決める。
  layout_cells_csv = Rails.root.join("db/seed_data/#{prefix}_item_layout_cells.csv")
  if File.exist?(layout_cells_csv)
    cells_by_layout = Hash.new { |h, k| h[k] = [] }
    CSV.foreach(layout_cells_csv, headers: true) do |row|
      layout_name = row["layout_name"].to_s.strip
      next if layout_name.blank?

      cells_by_layout[layout_name] << {
        grid_row: row["grid_row"].to_i,
        grid_column: row["grid_column"].to_i,
        cell_type: row["cell_type"].to_s.strip.presence || "item",
        item_code: row["item_code"].to_s.strip.presence,
        display_name: row["display_name"].to_s.strip.presence
      }
    end

    loaded = 0
    skipped = 0
    cells_by_layout.each_with_index do |(layout_name, cells), index|
      if models[:layout].exists?(name: layout_name)
        skipped += 1
        next
      end

      models[:layout].transaction do
        layout = models[:layout].create!(
          name: layout_name,
          row_count: cells.map { |c| c[:grid_row] }.max,
          column_count: cells.map { |c| c[:grid_column] }.max,
          display_order: (index + 1) * 10
        )
        cells.each { |cell| models[:layout_cell].create!(cell.merge(layout_id: layout.id)) }
      end
      loaded += 1
    end
    puts "#{models[:layout].table_name}: seeded #{loaded} layouts (kept #{skipped})"
  else
    puts "#{models[:layout].table_name}: #{layout_cells_csv} not found, skipped"
  end
end

# 生理検査オーダーのマスタ一式(db/seed_data/physio_*.csv)。生理検査は JJ1017 のような
# 配布マスタが無いので、一般病院で使う代表的な検査を医科点数表 D 章(生体検査)から
# 拾った初期値。断層撮影法(その他)を頸動脈・甲状腺・乳腺… に分ける等、1 コードを
# 複数項目にした所は枝番。伝票は検査種別ごとに 1 行(左端がラベル)で、マスの表示名は
# 短い略称にしてある(マスは 34px 固定で正式名は折り返して欠ける。処置も同じ)。
seed_department_order_masters.call("physio", {
  item: Master::PhysioItem,
  set_item: Master::PhysioSetItem,
  dataset: Master::PhysioDataset,
  dataset_detail: Master::PhysioDatasetDetail,
  layout: Master::PhysioItemLayout,
  layout_cell: Master::PhysioItemLayoutCell
})

# 処置オーダーのマスタ一式(db/seed_data/treatment_*.csv)。医科点数表 J 章(処置)から
# 病棟・外来で日常的に使う処置を拾った初期値。処置は検査種別を持たないので、
# 伝票のラベル行(創傷・皮膚 / 呼吸器 / 消化器 / 泌尿器 / 整形・固定 / 穿刺・救急 /
# 耳鼻咽喉 / 眼科 / セット)が分類の代わり。面積・部位で点数が分かれる処置は代表的な
# 区分だけ入れてあり、他の区分は施設で足す前提。
seed_department_order_masters.call("treatment", {
  item: Master::TreatmentItem,
  set_item: Master::TreatmentSetItem,
  dataset: Master::TreatmentDataset,
  dataset_detail: Master::TreatmentDatasetDetail,
  layout: Master::TreatmentItemLayout,
  layout_cell: Master::TreatmentItemLayoutCell
})
