# データ抽出の条件の初期値(院内共通)を、同梱の JSON から投入する(docs/data-extract-design.md)。
#
# JSON は条件をコードまで書いた完成形で持つ(病名は ICD10、検査は結果項目コード)。形は
# ExtractQuery の検証に通す。同じタブに同じ名前の院内共通の条件があれば触らない(施設で直した内容を戻さない)。
#
# 記録タブの条件は "tab" を持つ(無ければ「患者」タブ)。記録タブの条件が「患者」タブの条件で患者を絞るときは、
# code が環境ごとに違うので definition に "patient_query_name"(院内共通の「患者」タブの条件の名前)で書き、
# 投入のときに code に置き換える(見つからなければ絞り込みを外す)。比較群・指標の分母・分子が「患者」タブの条件を
# 指すときも同じく "patient_query_name" で書き、"query_code" に置き換える(見つからなければその条件は入れない)。
class ExtractQueryPresets
  Result = Struct.new(:created, :kept, :skipped, keyword_init: true)

  def self.load!(path)
    new(JSON.parse(File.read(path))).load!
  end

  def initialize(presets)
    @presets = presets
  end

  def load!
    result = Result.new(created: 0, kept: 0, skipped: [])
    order = ExtractQuery.where(scope: "facility").maximum(:display_order).to_i

    # tab の列を足す前の migration から呼ばれたときは「患者」タブの条件だけを入れる。
    tabs = ExtractQuery.column_names.include?("tab")
    @presets.each do |preset|
      tab = preset["tab"] || ExtractQuery::PATIENT_TAB
      next if !tabs && tab != ExtractQuery::PATIENT_TAB

      if ExtractQuery.exists?(scope: "facility", name: preset["name"], **(tabs ? { tab: tab } : {}))
        result.kept += 1
        next
      end

      definition = resolve_patient_query(preset["definition"])
      if definition.nil?
        result.skipped << preset["name"]
        next
      end

      order += 1
      ExtractQuery.create!(scope: "facility", name: preset["name"], display_order: order,
                           definition: definition, **(tabs ? { tab: tab } : {}))
      result.created += 1
    end
    result
  end

  private

  NESTED_SOURCES = %w[denominator numerator].freeze

  # 「患者」タブの条件の名前を code に置き換える。入れ子(分母・分子・比較群)の名前が見つからなければ nil(条件を入れない)。
  def resolve_patient_query(definition)
    name = definition["patient_query_name"]
    resolved = definition.except("patient_query_name")
    if name
      code = code_of(name)
      resolved = resolved.merge("patient_query_code" => code) if code
    end
    NESTED_SOURCES.each do |field|
      next unless resolved[field].is_a?(Hash) && resolved[field].key?("patient_query_name")

      source = resolve_source(resolved[field])
      return nil if source.nil?

      resolved = resolved.merge(field => source)
    end
    if resolved["strata"].is_a?(Array)
      strata = resolved["strata"].map { |stratum| stratum.key?("patient_query_name") ? resolve_source(stratum) : stratum }
      return nil if strata.any?(&:nil?)

      resolved = resolved.merge("strata" => strata)
    end
    resolved
  end

  def resolve_source(source)
    code = code_of(source["patient_query_name"])
    code && source.except("patient_query_name").merge("query_code" => code)
  end

  def code_of(name)
    ExtractQuery.find_by(scope: "facility", tab: ExtractQuery::PATIENT_TAB, name: name)&.code
  end
end
