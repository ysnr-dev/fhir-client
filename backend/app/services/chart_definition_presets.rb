# 疾患別のチャート定義の初期値(院内共通)を、同梱の JSON から投入する。
#
# JSON は項目をコードだけで持ち(検査は結果項目コード、バイタルは LOINC、薬剤は YJ コードの
# 先頭 7 桁)、名称・単位・coding は投入時にマスタから引いて、画面が作るのと同じ形にそろえる
# (frontend/src/fhir/chartDefinitionHelpers.ts の labChartItem / vitalChartItems / chartDrugOf)。
# マスタに無い検査項目は落とし、項目も薬剤も残らない定義は作らない。
#
# テンプレートの項目は上流の Questionnaire にあって backend からは引けないので、JSON に
# 項目コード・名称・単位・選択肢まで書く(docs/report-mappings の Questionnaire と同じ値)。
# key は環境ごとに変わる Questionnaire の id ではなく canonical URL で作る。
#
# 同じ名前の院内共通の定義があれば触らない(施設で直した内容を戻さない。他のマスタの初期値と同じ)。
class ChartDefinitionPresets
  RESULT_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-item".freeze
  JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11".freeze
  LOINC_SYSTEM = "http://loinc.org".freeze
  TEMPLATE_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/observation-item".freeze

  # frontend の VITAL_MEASURES + 血圧 + BMI と同じ並び・名称・単位。
  VITALS = {
    "8310-5" => { name: "体温", unit: "℃", display: "Body temperature" },
    "8867-4" => { name: "脈拍", unit: "/分", display: "Heart rate" },
    "2708-6" => { name: "SpO2", unit: "%", display: "Oxygen saturation in Arterial blood" },
    "9279-1" => { name: "呼吸数", unit: "/分", display: "Respiratory rate" },
    "8302-2" => { name: "身長", unit: "cm", display: "Body height" },
    "29463-7" => { name: "体重", unit: "kg", display: "Body weight" },
    "85354-9" => {
      name: "血圧", unit: "mmHg", display: "Blood pressure panel",
      components: [{ "code" => "8480-6", "name" => "収縮期" }, { "code" => "8462-4", "name" => "拡張期" }]
    },
    "39156-5" => { name: "BMI", unit: "kg/m2", display: "Body mass index (BMI) [Ratio]" }
  }.freeze

  Result = Struct.new(:created, :kept, :skipped_items, keyword_init: true)

  def self.load!(path)
    new(JSON.parse(File.read(path))).load!
  end

  def initialize(presets)
    @presets = presets
  end

  def load!
    result = Result.new(created: 0, kept: 0, skipped_items: [])
    order = ChartDefinition.where(scope: "facility").maximum(:display_order).to_i

    @presets.each do |preset|
      if ChartDefinition.exists?(scope: "facility", name: preset["name"])
        result.kept += 1
        next
      end

      items = Array(preset["items"]).filter_map { |item| build_item(item, preset["name"], result) }
      drugs = Array(preset["drugs"]).map { |drug| build_drug(drug) }
      next if items.empty? && drugs.empty?

      order += 1
      ChartDefinition.create!(
        scope: "facility",
        name: preset["name"],
        display_order: order,
        definition: {
          "schema_version" => ChartDefinition::SCHEMA_VERSION,
          "axis" => preset["axis"] || ChartDefinition::DEFAULT_DEFINITION["axis"],
          "items" => items,
          "events" => Array(preset["events"]),
          "drugs" => drugs,
          "overlay" => preset["overlay"] == true
        }
      )
      result.created += 1
    end
    result
  end

  private

  def build_item(spec, preset_name, result)
    return lab_item(spec["lab"], preset_name, result) if spec["lab"]
    return vital_item(spec["vital"]) if spec["vital"]
    return template_item(spec["template"]) if spec["template"]

    nil
  end

  # 画面の labChartItem と同じ形。数値型(PQ)でない項目はグラフにならないので落とす。
  def lab_item(code, preset_name, result)
    item = Master::LabResultItem.find_by(result_item_code: code)
    unless item&.data_type == "PQ"
      result.skipped_items << "#{preset_name}: #{code}"
      return nil
    end

    codings = [{ "system" => RESULT_ITEM_SYSTEM, "code" => item.result_item_code, "display" => item.name }]
    codings << { "system" => JLAC11_SYSTEM, "code" => item.jlac11_code } if item.jlac11_code.present?
    {
      "key" => "lab:#{item.result_item_code}",
      "source" => "lab",
      "name" => item.short_name.presence || item.name,
      "unit" => item.display_unit.to_s,
      "codings" => codings
    }
  end

  def vital_item(code)
    vital = VITALS.fetch(code)
    {
      "key" => "vital:#{code}",
      "source" => "vital",
      "name" => vital[:name],
      "unit" => vital[:unit],
      "codings" => [{ "system" => LOINC_SYSTEM, "code" => code, "display" => vital[:display] }],
      "components" => vital[:components]
    }.compact
  end

  # 画面の templateChartItems と同じ形。選択肢があれば帯の行になる。
  def template_item(spec)
    {
      "key" => "template:#{spec.fetch('url')}:#{spec.fetch('link_id')}",
      "source" => "template",
      "name" => spec.fetch("name"),
      "unit" => spec["unit"].to_s,
      "codings" => [{ "system" => TEMPLATE_ITEM_SYSTEM, "code" => spec.fetch("code"), "display" => spec.fetch("display") }],
      "options" => spec["options"]
    }.compact
  end

  # 画面の chartDrugOf と同じく YJ 先頭 7 桁でまとめる。YJ コードを持たない処方(HOT に無い薬剤)も
  # 拾えるよう、その成分・投与経路の薬剤のレセ電コードを薬価基準コードから集めて codes に持つ。
  def build_drug(spec)
    codes = Master::Medicine.where("yakka_code LIKE ?", "#{spec['yj7']}%").order(:medicine_code).pluck(:medicine_code)
    { "key" => "yj7:#{spec['yj7']}", "name" => spec["name"], "yj7" => spec["yj7"], "codes" => codes }
  end
end
