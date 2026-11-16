require "csv"
require "set"

# 成分マスタ(薬価基準コードの上 7 桁・上 9 桁 → 成分)の取込ファイルを作る。
# docs/drug-check-master-design.md
#
# 入力(どちらも配布物。git には入れない):
#   tmp/master-data/rxnorm/rxnorm_mapping.tsv  日本の医薬品と RxNorm の対応表(Kimura ら, Data in Brief 2025, CC BY 4.0)
#   tmp/master-data/athena/                    OHDSI Athena の語彙表(RxNorm・RxNorm Extension)
# 出力:
#   tmp/master-data/medicine_ingredients/medicine_ingredients.csv  取込画面に渡すファイル
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
    ingredients = load_ingredients
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
    write(entries, ingredients, names_ja, conflicts)
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

      { code: row[code_index].to_s.strip, concept_id: row["OSV_ID"], name_ja: row["Ingredient"].to_s.gsub(/[[:space:]]+/, "") }
    end
  end

  # 成分の概念。concept_id → { name:, rxcui: }。RxNorm Extension の成分は RxCUI を持たない。
  def load_ingredients
    ingredients = {}
    each_line("athena/CONCEPT.csv") do |fields|
      id, name, _domain, vocabulary, concept_class, _standard, code = fields
      next unless concept_class == "Ingredient" && INGREDIENT_VOCABULARIES.include?(vocabulary)

      ingredients[id] = { name: name, rxcui: vocabulary == "RxNorm" ? code : nil }
    end
    ingredients
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

  def write(entries, ingredients, names_ja, conflicts)
    dir = @root.join("medicine_ingredients")
    FileUtils.mkdir_p(dir)
    count = 0
    CSV.open(dir.join("medicine_ingredients.csv"), "w") do |csv|
      csv << %w[code_prefix ingredient_id name name_ja rxcui]
      entries.sort.each do |prefix, ids|
        ids.each do |id|
          csv << [prefix, id, ingredients[id][:name], names_ja[id], ingredients[id][:rxcui]]
          count += 1
        end
      end
    end
    File.write(dir.join("conflicts.txt"), conflicts.sort.join("\n") + "\n")
    puts "#{count} 行(コード #{entries.size} 件、成分 #{entries.values.flatten.uniq.size} 種)、割れた群 #{conflicts.size} 件"
  end

  # Athena の語彙表はタブ区切り・引用符なし。数百 MB あるので 1 行ずつ読む。
  def each_line(relative)
    File.open(@root.join(relative), "r:UTF-8") do |io|
      io.gets
      io.each_line { |line| yield line.chomp.split("\t", -1) }
    end
  end
end
