# データ抽出の条件の初期値(院内共通)を、同梱の JSON から投入する(docs/data-extract-design.md)。
#
# JSON は条件をコードまで書いた完成形で持つ(病名は ICD10、検査は結果項目コード)。形は
# ExtractQuery の検証に通す。同じタブに同じ名前の院内共通の条件があれば触らない(施設で直した内容を戻さない)。
#
# 記録タブの条件は "tab" を持つ(無ければ「患者」タブ)。記録タブの条件が「患者」タブの条件で患者を絞るときは、
# code が環境ごとに違うので definition に "patient_query_name"(院内共通の「患者」タブの条件の名前)で書き、
# 投入のときに code に置き換える(見つからなければ絞り込みを外す)。
class ExtractQueryPresets
  Result = Struct.new(:created, :kept, keyword_init: true)

  def self.load!(path)
    new(JSON.parse(File.read(path))).load!
  end

  def initialize(presets)
    @presets = presets
  end

  def load!
    result = Result.new(created: 0, kept: 0)
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

      order += 1
      ExtractQuery.create!(scope: "facility", name: preset["name"], display_order: order,
                           definition: resolve_patient_query(preset["definition"]), **(tabs ? { tab: tab } : {}))
      result.created += 1
    end
    result
  end

  private

  def resolve_patient_query(definition)
    name = definition["patient_query_name"]
    return definition if name.nil?

    code = ExtractQuery.find_by(scope: "facility", tab: ExtractQuery::PATIENT_TAB, name: name)&.code
    definition.except("patient_query_name").merge(code ? { "patient_query_code" => code } : {})
  end
end
