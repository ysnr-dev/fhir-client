# データ抽出の条件の初期値(院内共通)を、同梱の JSON から投入する(docs/data-extract-design.md)。
#
# JSON は条件をコードまで書いた完成形で持つ(病名は ICD10、検査は結果項目コード)。形は
# ExtractQuery の検証に通す。同じ名前の院内共通の条件があれば触らない(施設で直した内容を戻さない)。
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

    @presets.each do |preset|
      if ExtractQuery.exists?(scope: "facility", name: preset["name"])
        result.kept += 1
        next
      end

      order += 1
      ExtractQuery.create!(scope: "facility", name: preset["name"], display_order: order,
                           definition: preset["definition"])
      result.created += 1
    end
    result
  end
end
