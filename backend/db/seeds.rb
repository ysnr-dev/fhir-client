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

# 検体検査オーダーのマスタ一式(db/seed_data/lab_order_items.csv /
# lab_panel_items.csv / lab_order_item_layout_cells.csv)。一般病院で日常的に出す
# 検体検査を医科点数表 第2章第3部 第1節 検体検査料(D000〜D015)から拾った初期値。
#   - order_item_code はレセ電算コード(9桁)と同じにしてある(術式・生理検査と同じ理由:
#     施設独自採番とぶつからず、再投入で追加分だけ入る)。1つのレセ電算コードが複数の
#     結果に分かれる包括項目(末梢血液一般検査 → 白血球数・赤血球数…)は「コード-枝番」、
#     レセ電算コードを持たない施設セットは SET-nn。
#   - 名称は点数表の略号(「ＴＰ」「ＢＩＬ／総」)ではなく臨床検査マスターの名称にしてある
#     (docs/lab-order-master-design.md §7 の名称の優先順)。点数表との対応は receipt_code。
#   - jlac_code が入るのは共有項目JLACコードマスタ(JLAC11)の公開分 43+5 項目だけ(§9-1)。
#     JLAC11 の測定法コードは試薬・機器の販売名単位なので(§2)、入れてあるのは
#     「測定法=その他」の代表コードで、施設で使う試薬にあわせて直す前提(§9-3)。
#   - 検体・採取管・院内実施/外注は施設の運用で決まるので、投入後は画面で直す前提。
#     採取管は検体の既定採取管で足りる項目には持たせず、分ける項目(血糖=フッ化管、
#     アンモニア=EDTA管 など)だけに入れてある。
#   - 既存行は上書きしない。パネル構成は行単位、伝票は同名があればマスごとスキップする
#     (施設で直した内容を戻さない)。
lab_order_items_csv = Rails.root.join("db/seed_data/lab_order_items.csv")
if File.exist?(lab_order_items_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(lab_order_items_csv, headers: true) do |row|
    code = row["order_item_code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank? || name.blank?

    if Master::LabOrderItem.exists?(order_item_code: code)
      skipped += 1
      next
    end

    Master::LabOrderItem.create!(
      order_item_code: code,
      name: name,
      short_name: row["short_name"].to_s.strip.presence,
      name_kana: row["name_kana"].to_s.strip.presence,
      category: row["category"].to_s.strip.presence,
      specimen_code: row["specimen_code"].to_s.strip.presence,
      container_code: row["container_code"].to_s.strip.presence,
      kind: row["kind"].to_s.strip.presence || "single",
      jlac_code: row["jlac_code"].to_s.strip.presence,
      jlac_code_system: row["jlac_code_system"].to_s.strip.presence,
      execution_type: row["execution_type"].to_s.strip.presence,
      receipt_code: row["receipt_code"].to_s.strip.presence,
      display_order: row["display_order"].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_lab_order_items: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_lab_order_items: #{lab_order_items_csv} not found, skipped"
end

lab_panel_items_csv = Rails.root.join("db/seed_data/lab_panel_items.csv")
if File.exist?(lab_panel_items_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(lab_panel_items_csv, headers: true) do |row|
    panel_code = row["panel_item_code"].to_s.strip
    member_code = row["member_item_code"].to_s.strip
    next if panel_code.blank? || member_code.blank?

    if Master::LabPanelItem.exists?(panel_item_code: panel_code, member_item_code: member_code)
      skipped += 1
      next
    end

    Master::LabPanelItem.create!(
      panel_item_code: panel_code,
      member_item_code: member_code,
      member_type: row["member_type"].to_s.strip.presence || "required",
      display_order: row["display_order"].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_lab_panel_items: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_lab_panel_items: #{lab_panel_items_csv} not found, skipped"
end

# 伝票は layout_name ごとに作り、行数・列数はマスの最大位置から決める(部門オーダーと同じ)。
lab_layout_cells_csv = Rails.root.join("db/seed_data/lab_order_item_layout_cells.csv")
if File.exist?(lab_layout_cells_csv)
  cells_by_layout = Hash.new { |hash, key| hash[key] = [] }
  CSV.foreach(lab_layout_cells_csv, headers: true) do |row|
    layout_name = row["layout_name"].to_s.strip
    next if layout_name.blank?

    cells_by_layout[layout_name] << {
      grid_row: row["grid_row"].to_i,
      grid_column: row["grid_column"].to_i,
      cell_type: row["cell_type"].to_s.strip.presence || "item",
      order_item_code: row["order_item_code"].to_s.strip.presence,
      display_name: row["display_name"].to_s.strip.presence
    }
  end

  loaded = 0
  skipped = 0
  cells_by_layout.each_with_index do |(layout_name, cells), index|
    if Master::LabOrderItemLayout.exists?(name: layout_name)
      skipped += 1
      next
    end

    Master::LabOrderItemLayout.transaction do
      layout = Master::LabOrderItemLayout.create!(
        name: layout_name,
        row_count: cells.map { |cell| cell[:grid_row] }.max,
        column_count: cells.map { |cell| cell[:grid_column] }.max,
        display_order: (index + 1) * 10
      )
      cells.each { |cell| Master::LabOrderItemLayoutCell.create!(cell.merge(layout_id: layout.id)) }
    end
    loaded += 1
  end
  puts "master_lab_order_item_layouts: seeded #{loaded} layouts (kept #{skipped})"
else
  puts "master_lab_order_item_layouts: #{lab_layout_cells_csv} not found, skipped"
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

# 放射線検査の器材マスタ(db/seed_data/rad_materials.csv)。施設が採用している製品を
# 登録する台帳なので、ここに入れるのは一般病院で使う代表的な物品の初期値。
# receipt_material_code はレセプト電算の特定器材コードで、算定対象でない物品(留置針・
# 三方活栓など)は空。製品名・メーカー・型番は施設で入れ替える前提なので入れていない。
# 既存行は上書きしない。
rad_materials_csv = Rails.root.join("db/seed_data/rad_materials.csv")
if File.exist?(rad_materials_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(rad_materials_csv, headers: true) do |row|
    code = row["material_code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank? || name.blank?

    if Master::RadMaterial.exists?(material_code: code)
      skipped += 1
      next
    end

    Master::RadMaterial.create!(
      material_code: code,
      name: name,
      name_kana: row["name_kana"].to_s.strip.presence,
      unit_name: row["unit_name"].to_s.strip.presence,
      receipt_material_code: row["receipt_material_code"].to_s.strip.presence,
      display_order: row["display_order"].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_rad_materials: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_rad_materials: #{rad_materials_csv} not found, skipped"
end

# 放射線検査の実施入力用データセット(db/seed_data/rad_datasets.csv /
# rad_dataset_details.csv)。実施入力に初期表示する手技料・造影剤・器材の組み合わせで、
# 撮影項目からは master_rad_items.dataset_code で参照する。
#   - 手技(procedure)は点数表 第2章第4部(画像診断)の写真診断・撮影・電子画像管理加算・
#     造影剤注入手技。**CT/MRI の撮影料は装置の列数・テスラ数で点数が変わる**ので、
#     入れてあるのは代表的な区分(CT=64列以上128列未満 / MRI=1.5T以上3T未満)。
#     施設の装置にあわせて画面で差し替える前提。画像診断管理加算は月単位の算定なので入れない。
#   - 造影剤(medicine)は薬価収載の製剤単位。数量は製剤の単位(シリンジなら1筒、散剤ならg)。
#   - 「使ったときだけ足す」明細は初期値OFF(default_selected=0)で候補として並べてある
#     (単純CTの造影剤一式・MRIの造影加算など)。実施入力の「造影剤を追加」等はこの候補から選ぶ。
#   - 明細は参照先マスタ(診療行為・医薬品・器材)の存在を確かめない(未取込でも投入され、
#     取込後に名称が出る)。処置・生理検査のデータセットと同じ扱い。
#   - 既存のデータセットは明細ごとスキップする(施設で直した内容を戻さない)。
rad_datasets_csv = Rails.root.join("db/seed_data/rad_datasets.csv")
rad_dataset_details_csv = Rails.root.join("db/seed_data/rad_dataset_details.csv")
if File.exist?(rad_datasets_csv) && File.exist?(rad_dataset_details_csv)
  details_by_dataset = Hash.new { |hash, key| hash[key] = [] }
  CSV.foreach(rad_dataset_details_csv, headers: true) do |row|
    dataset_code = row["dataset_code"].to_s.strip
    code = row["code"].to_s.strip
    next if dataset_code.blank? || code.blank?

    details_by_dataset[dataset_code] << {
      detail_type: row["detail_type"].to_s.strip,
      code: code,
      default_quantity: row["default_quantity"].to_s.strip.presence,
      route_code: row["route_code"].to_s.strip.presence,
      default_selected: row["default_selected"].to_s.strip != "0",
      display_order: row["display_order"].to_s.strip.presence&.to_i
    }
  end

  loaded = 0
  skipped = 0
  detail_count = 0
  CSV.foreach(rad_datasets_csv, headers: true) do |row|
    code = row["dataset_code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank? || name.blank?

    if Master::RadDataset.exists?(dataset_code: code)
      skipped += 1
      next
    end

    Master::RadDataset.transaction do
      Master::RadDataset.create!(
        dataset_code: code,
        name: name,
        name_kana: row["name_kana"].to_s.strip.presence,
        display_order: row["display_order"].to_s.strip.presence&.to_i
      )
      details_by_dataset[code].each do |detail|
        Master::RadDatasetDetail.create!(detail.merge(dataset_code: code))
        detail_count += 1
      end
    end
    loaded += 1
  end
  puts "master_rad_datasets: seeded #{loaded} rows with #{detail_count} details (kept #{skipped})"
else
  puts "master_rad_datasets: #{rad_datasets_csv} or #{rad_dataset_details_csv} not found, skipped"
end

# 放射線オーダーのマスタ一式(db/seed_data/rad_items.csv / rad_set_items.csv /
# rad_item_layout_cells.csv)。一般病院で日常的に出す撮影を、頻用コード表(別表F)の
# 32桁コードを要素に分解して作った初期値。
#   - item_code は数字6桁の連番(画面の自動採番と同じ形)、セットは S00001〜。
#     名称は頻用コード表のコード意味そのままで、現場の呼び名は short_name に置く。
#   - jj1017_code は要素から保存時に合成されるので CSV には持たせない(セットは要素を持たない)。
#   - **単純撮影(種別1、およびポータブルG)はグループ化可・予約不要**、それ以外の
#     モダリティ(CT・MRI・透視・血管撮影・核医学・骨塩定量・乳房)は**単独オーダー・予約必須**。
#     予約必須の項目は単独オーダーでなければならない(Master::RadItem の検証)ので、この2つは連動する。
#     セットの構成にできるのはグループ化可の項目だけなので、セットは単純撮影だけで組んである。
#   - Ver3.3 の頻用コード表に無い種別(F=乳房X線撮影 / G=ポータブル)は、対応する単純撮影の
#     要素を借りて種別だけ差し替えてある(Ver3.4 で新設された種別。db/seed_data/rad_jj1017_codes.csv 参照)。
#   - 所要時間は予約枠を押さえる目安の初期値。予約枠(appointment_schedule_id)は施設ごとに
#     作るものなので入れていない。実施入力のデータセット(dataset_code)は撮影区分ごとに
#     上の rad_datasets.csv のものを割り当ててある(セットは撮影そのものではないので持たない)。
#   - 既存行は上書きしない。セット構成は行単位、伝票は同名があればマスごとスキップする
#     (施設で直した内容を戻さない)。
rad_items_csv = Rails.root.join("db/seed_data/rad_items.csv")
if File.exist?(rad_items_csv)
  # 要素の列は「要素名 + _code」の規則で決まるので、要素が増えてもここは触らずに済む。
  rad_element_columns = Master::RadItem::ELEMENT_COLUMNS.values + [:generic_extension_code]
  loaded = 0
  skipped = 0
  CSV.foreach(rad_items_csv, headers: true) do |row|
    code = row["item_code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank? || name.blank?

    if Master::RadItem.exists?(item_code: code)
      skipped += 1
      next
    end

    attrs = {
      item_code: code,
      name: name,
      short_name: row["short_name"].to_s.strip.presence,
      name_kana: row["name_kana"].to_s.strip.presence,
      kind: row["kind"].to_s.strip.presence || "single",
      groupable: row["groupable"].to_s.strip != "0",
      requires_appointment: row["requires_appointment"].to_s.strip == "1",
      requires_perform_input: row["requires_perform_input"].to_s.strip != "0",
      dataset_code: row["dataset_code"].to_s.strip.presence,
      duration_minutes: row["duration_minutes"].to_s.strip.presence&.to_i,
      display_order: row["display_order"].to_s.strip.presence&.to_i
    }
    rad_element_columns.each { |column| attrs[column] = row[column.to_s].to_s.strip.presence }
    Master::RadItem.create!(attrs)
    loaded += 1
  end
  puts "master_rad_items: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_rad_items: #{rad_items_csv} not found, skipped"
end

rad_set_items_csv = Rails.root.join("db/seed_data/rad_set_items.csv")
if File.exist?(rad_set_items_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(rad_set_items_csv, headers: true) do |row|
    set_code = row["set_item_code"].to_s.strip
    member_code = row["member_item_code"].to_s.strip
    next if set_code.blank? || member_code.blank?

    if Master::RadSetItem.exists?(set_item_code: set_code, member_item_code: member_code)
      skipped += 1
      next
    end

    Master::RadSetItem.create!(
      set_item_code: set_code,
      member_item_code: member_code,
      display_order: row["display_order"].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_rad_set_items: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_rad_set_items: #{rad_set_items_csv} not found, skipped"
end

# 伝票は layout_name ごとに作り、行数・列数はマスの最大位置から決める(検体検査と同じ)。
rad_layout_cells_csv = Rails.root.join("db/seed_data/rad_item_layout_cells.csv")
if File.exist?(rad_layout_cells_csv)
  cells_by_layout = Hash.new { |hash, key| hash[key] = [] }
  CSV.foreach(rad_layout_cells_csv, headers: true) do |row|
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
    if Master::RadItemLayout.exists?(name: layout_name)
      skipped += 1
      next
    end

    Master::RadItemLayout.transaction do
      layout = Master::RadItemLayout.create!(
        name: layout_name,
        row_count: cells.map { |cell| cell[:grid_row] }.max,
        column_count: cells.map { |cell| cell[:grid_column] }.max,
        display_order: (index + 1) * 10
      )
      cells.each { |cell| Master::RadItemLayoutCell.create!(cell.merge(layout_id: layout.id)) }
    end
    loaded += 1
  end
  puts "master_rad_item_layouts: seeded #{loaded} layouts (kept #{skipped})"
else
  puts "master_rad_item_layouts: #{rad_layout_cells_csv} not found, skipped"
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

# 部門オーダー(生理検査・処置・内視鏡)の項目マスタ一式を CSV から投入する共通処理。
# いずれも「項目 → セット構成 → 実施入力データセット＋明細 → 伝票レイアウト」の
# 同型 4 テーブルなので、モデルと CSV の接頭辞だけ差し替えて使う。
#
#   #{prefix}_items.csv              (ヘッダー有り) item_code,name,short_name,name_kana,kind,
#                                    [exam_type_code,]receipt_code,dataset_code,
#                                    requires_perform_input,[groupable,requires_appointment,
#                                    duration_minutes,]display_order
#   #{prefix}_set_items.csv          set_item_code,member_item_code,display_order
#   #{prefix}_datasets.csv           dataset_code,name,name_kana,display_order
#   #{prefix}_dataset_details.csv    dataset_code,detail_type,code,[default_quantity,route_code,]
#                                    default_selected,display_order
#   #{prefix}_item_layout_cells.csv  layout_name,grid_row,grid_column,cell_type,item_code,display_name
#
# [ ] の列は部門ごとに有る無しが分かれる(検査種別は生理検査・内視鏡だけ、単独オーダー/予約と
# 薬剤の数量・経路は内視鏡だけ)。CSV に列が無ければモデルの既定値のままにする。
#
# 共通の考え方:
#   - item_code はレセ電算コード(9桁)と同じにしてある(術式マスタと同じ理由: 施設独自採番と
#     ぶつからず、再投入で追加分だけ入る)。1つのレセ電算コードを複数の項目に分ける場合は
#     「コード-枝番」、セットは SET-nn(レセ電算コードを持たない)。内視鏡だけは項目コードを
#     画面の自動採番と同じ数字6桁にしてある(§内視鏡のコメント)。
#   - 実施入力の手技明細はデータセットからしか展開されない(項目の receipt_code は実施時に
#     使わない)ので、項目ごとに自身の手技料を初期値ONで持つデータセットを添える。
#     明細は診療行為マスタの存在を確かめない(未取込でも投入され、取込後に名称が出る)。
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
      # 検査種別は生理検査・内視鏡だけが持つ(処置の CSV には列が無い)。
      attrs[:exam_type_code] = row["exam_type_code"].to_s.strip.presence if row.include?("exam_type_code")
      # 単独オーダー・予約は内視鏡だけが持つ(生理検査・処置はモデルの既定値のまま)。
      attrs[:groupable] = row["groupable"].to_s.strip != "0" if row.include?("groupable")
      if row.include?("requires_appointment")
        attrs[:requires_appointment] = row["requires_appointment"].to_s.strip == "1"
      end
      if row.include?("duration_minutes")
        attrs[:duration_minutes] = row["duration_minutes"].to_s.strip.presence&.to_i
      end
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

      detail = {
        detail_type: row["detail_type"].to_s.strip,
        code: code,
        default_selected: row["default_selected"].to_s.strip != "0",
        display_order: row["display_order"].to_s.strip.presence&.to_i
      }
      # 数量・経路は薬剤と器材を持つ部門(内視鏡)だけが列に持つ。
      if row.include?("default_quantity")
        detail[:default_quantity] = row["default_quantity"].to_s.strip.presence
      end
      detail[:route_code] = row["route_code"].to_s.strip.presence if row.include?("route_code")
      details_by_dataset[dataset_code] << detail
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

# 内視鏡オーダーのマスタ一式(db/seed_data/endoscopy_*.csv)。一般病院で日常的に出す
# 内視鏡の検査と治療を、医科点数表 D 章(内視鏡検査 D295〜D325)と K 章(内視鏡的〜の手術)から
# 拾った初期値。検査種別(exam_type_code)は上の endoscopy_exam_types.csv のコード。
#   - **項目コードは画面の自動採番と同じ数字6桁の連番**(セットは S00001〜)。内視鏡は
#     1つのレセ電算コードに経口/経鼻/鎮静下のような運用上の区別がぶら下がり(JED にも
#     オーダー項目のコード体系が無い / docs/endoscopy-order-design.md §1)、レセ電算コードを
#     項目コードにすると枝番だらけになるため。点数表との対応は receipt_code。
#   - **内視鏡室の枠を使う検査・治療は予約必須(=単独オーダー)、その場で行うものは予約不要**。
#     予約不要なのは緊急内視鏡・直腸鏡・肛門鏡・喉頭/鼻咽腔/嚥下内視鏡・膀胱鏡で、
#     セットに入れられるのはこの予約不要の項目だけ(予約必須は単独オーダーになる)。
#     所要時間は予約枠を押さえる目安で、予約枠(appointment_schedule_id)は施設ごとに作る
#     ものなので入れていない。
#   - データセットは検査・治療ごとに 1 つ。手技料に加えて、内視鏡で実際に使う
#     前処置(消泡剤・咽頭麻酔)・鎮痙剤・鎮静剤・拮抗剤・色素・前処置薬と、
#     粘膜下注入材・結紮セット・カプセル・胆道ドレナージ材料を並べてある。
#     **使ったときだけ足すものは初期値OFF**(鎮静剤・生検・色素・前処置薬など)で、
#     実施入力の「薬剤を追加」「器材を追加」はこの候補から開く(§3.1)。
#   - 検査目的・特別指示の既定テンプレートは検査種別ごとに施設で決めるものなので入れない。
seed_department_order_masters.call("endoscopy", {
  item: Master::EndoscopyItem,
  set_item: Master::EndoscopySetItem,
  dataset: Master::EndoscopyDataset,
  dataset_detail: Master::EndoscopyDatasetDetail,
  layout: Master::EndoscopyItemLayout,
  layout_cell: Master::EndoscopyItemLayoutCell
})

# 輸血製剤マスタ。db/seed_data/transfusion_products.csv（ヘッダー有り）から投入する。
# 日赤の血液製剤(赤血球・血漿・血小板)を医薬品マスタの収載単位で拾った初期値で、
# item_code はレセ電算の医薬品コード(9桁)と同じにしてある(術式・生理検査と同じ理由:
# 施設独自採番とぶつからず、再投入で追加分だけ入る)。自己血は薬価収載が無いので
# AUTO-xx。アルブミン等の血漿分画製剤は注射オーダーで扱う前提で入れていない。
# 交差適合試験の要否(requires_crossmatch)は赤血球系と貯血式自己血だけ 1 にしてあるが、
# 運用は施設で決めるので投入後は画面で直す前提。既存行は上書きしない。
transfusion_products_csv = Rails.root.join("db/seed_data/transfusion_products.csv")
if File.exist?(transfusion_products_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(transfusion_products_csv, headers: true) do |row|
    code = row["item_code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank? || name.blank?

    if Master::TransfusionProduct.exists?(item_code: code)
      skipped += 1
      next
    end

    Master::TransfusionProduct.create!(
      item_code: code,
      name: name,
      name_kana: row["name_kana"].to_s.strip.presence,
      abbreviation: row["abbreviation"].to_s.strip.presence,
      category: row["category"].to_s.strip.presence || "rbc",
      unit_label: row["unit_label"].to_s.strip.presence || "単位",
      default_units: row["default_units"].to_s.strip.presence&.to_i,
      requires_crossmatch: row["requires_crossmatch"].to_s.strip == "1",
      display_order: row["display_order"].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_transfusion_products: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_transfusion_products: #{transfusion_products_csv} not found, skipped"
end

# 食種の種別(分類)マスタ。db/seed_data/meal_categories.csv（ヘッダー無し,
# category_code,name,name_kana,nutrition_form,display_order）から投入する。
# 参考仕様(名古屋第二赤十字病院「食種選択によるオーダエントリ」§1)の分類にあわせた
# 4 分類を初期値とする。給与形態(nutrition_form)はオーダー画面が入力欄を切り替える
# 判断軸なので、施設が分類名を変えてもこの値は保つ(docs/meal-order-design.md §3.2)。
# 既存行は上書きしない（施設で直した内容を消さない）。
meal_categories_csv = Rails.root.join("db/seed_data/meal_categories.csv")
if File.exist?(meal_categories_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(meal_categories_csv) do |row|
    code = row[0].to_s.strip
    name = row[1].to_s.strip
    next if code.blank? || name.blank?

    if Master::MealCategory.exists?(category_code: code)
      skipped += 1
      next
    end

    Master::MealCategory.create!(
      category_code: code,
      name: name,
      name_kana: row[2].to_s.strip.presence,
      nutrition_form: row[3].to_s.strip.presence || "oral_diet",
      display_order: row[4].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_meal_categories: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_meal_categories: #{meal_categories_csv} not found, skipped"
end

# 食種マスタ。db/seed_data/meal_diets.csv（ヘッダー有り）から投入する。
# 一般病院の約束食事箋にある代表的な食種を並べた初期値で、item_code は SS-MIX2 の
# 給食オーダ(OMD^O03)の例示に寄せた形(A001xx=一般食 / A002xx=特別食 / E001xx=経管 /
# M001xx=調乳 / NPO=食止め)。施設独自採番(000001 のような連番)とぶつからない。
#
# **主成分量は施設の献立で決まるもので、ここの値は代表値にすぎない**。熱量と
# 三大栄養素の整合(蛋白 4 + 脂質 9 + 糖質 4)は取ってあるが、実際の献立の値に
# 栄養課が置き換える前提で投入する。適応・備考も同じく、施設の約束食事箋に
# あわせて画面で直す(docs/meal-order-design.md §3.3)。
# 既存行は上書きしない（施設で直した内容を消さない）。
meal_diets_csv = Rails.root.join("db/seed_data/meal_diets.csv")
if File.exist?(meal_diets_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(meal_diets_csv, headers: true) do |row|
    code = row["item_code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank? || name.blank?

    if Master::MealDiet.exists?(item_code: code)
      skipped += 1
      next
    end

    nutrients = Master::MealDiet::NUTRIENT_COLUMNS.index_with do |column|
      row[column].to_s.strip.presence&.to_d
    end

    Master::MealDiet.create!(
      {
        item_code: code,
        name: name,
        name_kana: row["name_kana"].to_s.strip.presence,
        is_fasting: row["is_fasting"].to_s.strip == "true",
        category_code: row["category_code"].to_s.strip.presence,
        indication: row["indication"].to_s.strip.presence,
        display_order: row["display_order"].to_s.strip.presence&.to_i
      }.merge(nutrients)
    )
    loaded += 1
  end
  puts "master_meal_diets: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_meal_diets: #{meal_diets_csv} not found, skipped"
end

# 食事オーダー項目マスタ(主食・副食形態)。db/seed_data/meal_items.csv（ヘッダー有り）
# から投入する。主食は SS-MIX2 の ODS-1=D にあたり、item_code は例示に寄せた 105Axx。
# 副食形態(F0x)は SS-MIX2 に対応する区分が無く、参考仕様 §2 から採った項目。
# 主食の量(米飯180g など)は名称に焼き込む運用(docs/meal-order-design.md §3)。
# 呼び名も刻みの段階数も施設で違うので、投入後は画面で直す前提。
# 既存行は上書きしない（施設で直した内容を消さない）。
meal_items_csv = Rails.root.join("db/seed_data/meal_items.csv")
if File.exist?(meal_items_csv)
  loaded = 0
  skipped = 0
  CSV.foreach(meal_items_csv, headers: true) do |row|
    code = row["item_code"].to_s.strip
    name = row["name"].to_s.strip
    next if code.blank? || name.blank?

    if Master::MealItem.exists?(item_code: code)
      skipped += 1
      next
    end

    Master::MealItem.create!(
      item_code: code,
      name: name,
      name_kana: row["name_kana"].to_s.strip.presence,
      kind: row["kind"].to_s.strip.presence || "staple",
      display_order: row["display_order"].to_s.strip.presence&.to_i
    )
    loaded += 1
  end
  puts "master_meal_items: seeded #{loaded} rows (kept #{skipped})"
else
  puts "master_meal_items: #{meal_items_csv} not found, skipped"
end

# 経過表の水分出納(In/Out)に数える看護観察。db/seed_data/water_balance_items.csv
# （ヘッダー有り, side,manage_no,name）から施設設定(facility_settings.water_balance)に
# 入れる。値は MEDIS の観察名称管理番号で、name は読むための列(投入では使わない)。
#
# 一般病棟の温度板で数える代表的な項目を並べた初期値で、**施設の運用で足し引きする
# 前提**(導尿・膀胱瘻を分けるか、ドレーンをどこまで数えるかは施設で違う。ドレーン
# 排液は 200 件超あるので既定には入れない)。設定画面の「水分出納の対象項目」で直す。
#
# **輸液量(31000014)は入れていない**。点滴は注射の実施記録から mL に換算して IN に
# 足すので(docs/flowsheet-design.md §7.2)、観察としても数えると二重計上になる。
#
# 既に対象項目を選んである施設は上書きしない（施設で直した内容を消さない）。
water_balance_csv = Rails.root.join("db/seed_data/water_balance_items.csv")
if File.exist?(water_balance_csv)
  settings = FacilitySettings.current
  stored = settings.water_balance_with_defaults
  if stored.values.any?(&:present?)
    puts "facility_settings.water_balance: already configured, kept"
  else
    items = FacilitySettings::WATER_BALANCE_KEYS.index_with { [] }
    CSV.foreach(water_balance_csv, headers: true) do |row|
      side = row["side"].to_s.strip
      manage_no = row["manage_no"].to_s.strip
      next if manage_no.blank? || !items.key?(side)

      items[side] << manage_no unless items[side].include?(manage_no)
    end

    settings.update!(water_balance: items)
    puts "facility_settings.water_balance: seeded in #{items['in'].size} / out #{items['out'].size} items"
  end
else
  puts "facility_settings.water_balance: #{water_balance_csv} not found, skipped"
end
