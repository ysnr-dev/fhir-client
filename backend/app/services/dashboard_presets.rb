# ダッシュボードの初期値(院内共通)を、同梱の JSON から投入する(docs/dashboard-design.md)。
#
# タイルは条件を code ではなく院内共通の条件のタブ("query_tab"、無ければ「患者」タブ)と名前("query_name")で書き、
# 投入のときに code に置き換える(code は環境ごとに違う)。見つからない条件のタイルは置かない。
# 同じ名前の院内共通のダッシュボードがあれば触らない(施設で直した並べ方を戻さない)。
class DashboardPresets
  Result = Struct.new(:created, :kept, :missing, keyword_init: true)

  def self.load!(path)
    new(JSON.parse(File.read(path))).load!
  end

  def initialize(presets)
    @presets = presets
  end

  def load!
    result = Result.new(created: 0, kept: 0, missing: [])
    order = Dashboard.where(scope: "facility").maximum(:display_order).to_i

    @presets.each do |preset|
      if Dashboard.exists?(scope: "facility", name: preset["name"])
        result.kept += 1
        next
      end

      tiles = preset["tiles"].filter_map.with_index(1) do |tile, i|
        tab = tile["query_tab"] || ExtractQuery::PATIENT_TAB
        code = ExtractQuery.find_by(scope: "facility", tab: tab, name: tile["query_name"])&.code
        if code.nil?
          result.missing << "#{preset["name"]}: #{tile["query_name"]}"
          next
        end

        tile.except("query_tab", "query_name").merge("id" => "t#{i}", "query_code" => code)
      end

      order += 1
      Dashboard.create!(scope: "facility", name: preset["name"], display_order: order,
                        definition: { "schema_version" => Dashboard::SCHEMA_VERSION, "tiles" => tiles })
      result.created += 1
    end
    result
  end
end
