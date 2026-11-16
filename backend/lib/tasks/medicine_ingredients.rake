require "csv"
require "set"

# 成分マスタ(薬価基準コードの上 7 桁・上 9 桁 → 成分)の取込ファイルを作る。
# docs/drug-check-master-design.md
#
# 入力(どちらも配布物。git には入れない):
#   tmp/master-data/rxnorm/rxnorm_mapping.tsv  日本の医薬品と RxNorm の対応表(Kimura ら, Data in Brief 2025, CC BY 4.0)
#   tmp/master-data/athena/                    OHDSI Athena の語彙表(RxNorm・RxNorm Extension・ATC)
# 出力:
#   tmp/master-data/medicine_ingredients/medicine_ingredients.csv  取込画面「成分マスタ」に渡すファイル
#   tmp/master-data/medicine_ingredients/atc_classes.csv           取込画面「ATC 分類」に渡すファイル
#   tmp/master-data/medicine_ingredients/conflicts.txt             同じコードの中で成分が割れた群(目で確認する)
namespace :medicine_ingredients do
  desc "対応表と Athena の語彙表から成分マスタの取込ファイルを作る"
  task generate: :environment do
    MedicineIngredientsGenerator.new(Rails.root.join("tmp/master-data")).call
  end
end

class MedicineIngredientsGenerator
  # 対応表の COMMENT 列の先頭。漢方・生薬は対応先の誤りが多いので使わない。
  SKIPPED_COMMENTS = %w[03 04].freeze
  INGREDIENT_VOCABULARIES = ["RxNorm", "RxNorm Extension"].freeze
  # ATC の 5 階層目(成分)から、その主成分へ張られた関係。配合剤の相手側の成分は含まれない。
  ATC_INGREDIENT_RELATIONSHIP = "ATC - RxNorm pr lat".freeze
  # 配合剤の ATC(「atorvastatin and amlodipine」「…, combinations」)は成分の群に使わない。
  ATC_COMBINATION_NAME = /combinations| and /
  # 群として選べる階層(2〜4 階層目)。
  ATC_CLASS_LEVELS = ["ATC 2nd", "ATC 3rd", "ATC 4th"].freeze
  # 含量を持たせる配合剤の薬価単位(1 錠・1 カプセルあたりの量が決まるもの)。
  COUNTABLE_SPECIFICATION = /1(?:錠|カプセル)\z/
  # 含量は mg に揃える。UCUM の単位 → mg への係数。
  MG_FACTORS = { "mg" => 1.0, "ug" => 0.001, "g" => 1000.0 }.freeze

  # 対応表の誤り・表記ゆれの訂正。コードの上 7 桁 → その成分すべてに当てる concept_id。
  # 割れた群(conflicts.txt)を見て足す。
  CORRECTIONS = {
    "2190009" => %w[19078126], # ポリスチレンスルホン酸ナトリウム(散がカルシウム塩に対応していた)
    "2391002" => %w[1000772],  # グラニセトロン(細粒が galactose に対応していた)
    "2413404" => %w[1542948],  # ホリトロピン アルファ(ペンの一部が beta に対応していた)
    "3150002" => %w[19056802], # トコフェロール酢酸エステル(tocopherol と alpha tocopherol に割れていた)
    "3334402" => %w[1367571],  # ヘパリンナトリウム(heparin に寄せる)
    "3992001" => %w[19015230], # アデノシン三リン酸(顆粒と 60mg 錠が adenosine に対応していた)
    "3999432" => %w[19015768], # エポエチン ベータ ペゴル(25μg が epoetin beta に対応していた)
    "4291060" => %w[746225],   # キザルチニブ(塩の有無で割れていた)
  }.freeze

  def initialize(root)
    @root = root
  end

  def call
    rows = mapping_rows
    load_concepts
    ingredients = @ingredients
    sets = ingredient_sets(rows.map { |r| r[:concept_id] }.to_set, ingredients)

    by9 = rows.group_by { |r| r[:code][0, 9] }.transform_values do |group|
      tally = group.map { |r| sets[r[:concept_id]] }.reject(&:empty?).tally
      tally.sort_by { |set, count| [-count, set] }
    end
    by9.each_key { |prefix9| by9[prefix9] = [[CORRECTIONS[prefix9[0, 7]].sort, 1]] if CORRECTIONS.key?(prefix9[0, 7]) }

    conflicts = []
    entries = {}
    by9.group_by { |prefix, _| prefix[0, 7] }.each do |prefix7, groups|
      chosen = groups.to_h { |prefix9, tally| [prefix9, tally.first&.first] }.compact
      groups.each do |prefix9, tally|
        conflicts << conflict_line(prefix9, tally, ingredients) if tally.size > 1
      end
      next if chosen.empty?

      if chosen.values.uniq.size == 1
        entries[prefix7] = chosen.values.first
      else
        conflicts << "#{prefix7}: 規格ごとに成分が違うので上 9 桁で持つ"
        entries.merge!(chosen)
      end
    end

    names_ja = japanese_names(rows, sets)
    used = entries.values.flatten.to_set
    atc_codes = ingredient_atc_codes(used)
    contents = combination_contents(rows, sets, by9, conflicts)
    write(entries, ingredients, names_ja, conflicts, atc_codes, contents)
    write_atc_classes(atc_codes)
  end

  private

  def mapping_rows
    path = @root.join("rxnorm/rxnorm_mapping.tsv")
    table = CSV.read(path, col_sep: "\t", headers: true, liberal_parsing: true, quote_char: nil, encoding: "BOM|UTF-8")
    headers = table.headers.map { |h| h.to_s.strip }
    code_index = headers.index("NHIDPLC")
    table.filter_map do |row|
      next if SKIPPED_COMMENTS.include?(row["COMMENT"].to_s[0, 2])
      next unless row["OSV_ID"].to_s.match?(/\A\d+\z/)

      {
        code: row[code_index].to_s.strip,
        concept_id: row["OSV_ID"],
        name_ja: row["Ingredient"].to_s.gsub(/[[:space:]]+/, ""),
        specification: row["Specification"].to_s.unicode_normalize(:nfkc).gsub(/[[:space:]]+/, ""),
      }
    end
  end

  # CONCEPT を 1 回読んで、成分・ATC・単位を拾う。
  #   @ingredients  concept_id → { name:, rxcui: }。RxNorm Extension の成分は RxCUI を持たない
  #   @atc          concept_id → { code:, name:, level: }(有効なものだけ)
  #   @units        concept_id → UCUM の単位
  def load_concepts
    @ingredients = {}
    @atc = {}
    @units = {}
    each_line("athena/CONCEPT.csv") do |fields|
      id, name, _domain, vocabulary, concept_class, _standard, code, _from, _to, invalid = fields
      if concept_class == "Ingredient" && INGREDIENT_VOCABULARIES.include?(vocabulary)
        @ingredients[id] = { name: name, rxcui: vocabulary == "RxNorm" ? code : nil }
      elsif vocabulary == "ATC" && invalid.blank?
        @atc[id] = { code: code, name: name, level: concept_class }
      elsif vocabulary == "UCUM"
        @units[id] = code
      end
    end
  end

  # 成分 → ATC の 5 階層目のコード。その成分が主成分の単剤のコードだけ。
  def ingredient_atc_codes(ingredient_ids)
    codes = Hash.new { |hash, key| hash[key] = [] }
    each_line("athena/CONCEPT_RELATIONSHIP.csv") do |fields|
      atc_id, ingredient_id, relationship, _from, _to, invalid = fields
      next unless relationship == ATC_INGREDIENT_RELATIONSHIP && invalid.blank?
      next unless ingredient_ids.include?(ingredient_id)

      atc = @atc[atc_id]
      next unless atc && atc[:level] == "ATC 5th" && !atc[:name].match?(ATC_COMBINATION_NAME)

      codes[ingredient_id] << atc[:code]
    end
    codes.each_value { |list| list.sort!.uniq! }
    codes
  end

  # 配合剤の 1 錠・1 カプセルあたりの成分量(mg)。コードの上 9 桁 → { 成分 → mg }。
  # 単剤は投与量換算マスタ(規格から作る)で足りるので持たない。対応先によって量が食い違う規格は載せない。
  def combination_contents(rows, sets, by9, conflicts)
    strengths = drug_strengths(rows.map { |r| r[:concept_id] }.to_set)
    contents = {}
    rows.group_by { |r| r[:code][0, 9] }.each do |prefix9, group|
      set = by9[prefix9]&.first&.first
      next unless set && set.size > 1
      next unless group.all? { |r| r[:specification].match?(COUNTABLE_SPECIFICATION) }

      candidates = group.filter_map { |r| strengths[r[:concept_id]] if sets[r[:concept_id]] == set }.uniq
      if candidates.size == 1 && candidates.first.keys.sort == set
        contents[prefix9] = candidates.first
      elsif candidates.size > 1
        conflicts << "#{prefix9}: 配合剤の含量が対応先で食い違うので持たない"
      end
    end
    contents
  end

  # 製剤の概念 → { 成分 → mg }。量(1 単位あたり)で書かれ、mg に直せるものだけ。
  def drug_strengths(concept_ids)
    strengths = Hash.new { |hash, key| hash[key] = {} }
    unusable = Set.new
    each_line("athena/DRUG_STRENGTH.csv") do |fields|
      drug, ingredient, amount, amount_unit = fields
      next unless concept_ids.include?(drug)

      factor = MG_FACTORS[@units[amount_unit]]
      if amount.present? && factor
        strengths[drug][ingredient] = (amount.to_f * factor).round(6)
      else
        unusable << drug
      end
    end
    strengths.except(*unusable)
  end

  # 対応先の概念(製剤)→ 成分の concept_id の並び。配合剤は複数になる。
  def ingredient_sets(concept_ids, ingredients)
    sets = Hash.new { |hash, key| hash[key] = [] }
    each_line("athena/CONCEPT_ANCESTOR.csv") do |fields|
      ancestor, descendant = fields
      sets[descendant] << ancestor if concept_ids.include?(descendant) && ingredients.key?(ancestor)
    end
    sets.each_value { |ids| ids.sort!.uniq! }
    sets
  end

  # 成分の日本語名。その成分だけを含む薬の日本語成分名で、いちばん多いもの。
  def japanese_names(rows, sets)
    tallies = Hash.new { |hash, key| hash[key] = Hash.new(0) }
    rows.each do |row|
      set = sets[row[:concept_id]]
      tallies[set.first][row[:name_ja]] += 1 if set.size == 1 && row[:name_ja].present?
    end
    tallies.transform_values { |tally| tally.max_by { |name, count| [count, -name.size] }.first }
  end

  def conflict_line(prefix, tally, ingredients)
    parts = tally.map { |set, count| "#{set.map { |id| ingredients[id][:name] }.join(' + ')} ×#{count}" }
    "#{prefix}: #{parts.join(' / ')}"
  end

  def write(entries, ingredients, names_ja, conflicts, atc_codes, contents)
    FileUtils.mkdir_p(output_dir)
    # 含量を持つ規格は上 9 桁の行で書く(同じ成分でも規格ごとに量が違うため)。
    contents.each_key { |prefix9| entries[prefix9] ||= entries[prefix9[0, 7]] }
    count = 0
    CSV.open(output_dir.join("medicine_ingredients.csv"), "w") do |csv|
      csv << %w[code_prefix ingredient_id name name_ja rxcui atc_codes amount amount_unit]
      entries.sort.each do |prefix, ids|
        ids.each do |id|
          amount = contents.dig(prefix, id)
          csv << [prefix, id, ingredients[id][:name], names_ja[id], ingredients[id][:rxcui],
                  atc_codes[id].join(" "), amount, amount && "mg"]
          count += 1
        end
      end
    end
    File.write(output_dir.join("conflicts.txt"), conflicts.sort.join("\n") + "\n")
    used = entries.values.flatten.uniq
    puts "成分マスタ #{count} 行(コード #{entries.size} 件、成分 #{used.size} 種、うち ATC あり #{used.count { |id| atc_codes[id].any? }} 種、" \
         "含量つきの配合剤 #{contents.size} 規格)、確認が要る群 #{conflicts.size} 件"
  end

  # 成分に付いたコードの上位(2〜4 階層目)の分類と名称。
  def write_atc_classes(atc_codes)
    prefixes = atc_codes.values.flatten.flat_map { |code| [code[0, 3], code[0, 4], code[0, 5]] }.to_set
    classes = @atc.values.select { |atc| ATC_CLASS_LEVELS.include?(atc[:level]) && prefixes.include?(atc[:code]) }
    CSV.open(output_dir.join("atc_classes.csv"), "w") do |csv|
      csv << %w[code name]
      classes.sort_by { |atc| atc[:code] }.each { |atc| csv << [atc[:code], atc[:name]] }
    end
    puts "ATC 分類 #{classes.size} 行"
  end

  def output_dir
    @root.join("medicine_ingredients")
  end

  # Athena の語彙表はタブ区切り・引用符なし。数百 MB あるので 1 行ずつ読む。
  def each_line(relative)
    File.open(@root.join(relative), "r:UTF-8") do |io|
      io.gets
      io.each_line { |line| yield line.chomp.split("\t", -1) }
    end
  end
end
