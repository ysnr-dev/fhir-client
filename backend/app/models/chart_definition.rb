# チャート(数値の推移と治療イベントを同じ時間軸で読む画面)の定義 1 件。
#
# 「どの項目を並べ、どのイベントを重ね、横軸をどの粒度で見るか」だけを持ち、患者は
# 持たない。同じ定義をどの患者に当ててもよい。持ち主(scope / owner_id)は
# オーダーセットと同じ 3 段階で、院内共通は owner_id を持たない。
#
# definition は jsonb で、形は次のとおり。
#
#   { "schema_version": 1,
#     "axis": { "unit": "month", "columns": 12 },
#     "items": [
#       { "key": "lab:0001", "source": "lab", "name": "WBC", "unit": "10*3/uL",
#         "codings": [{ "system": "...", "code": "0001", "display": "WBC" }] },
#       { "key": "vital:85354-9", "source": "vital", "name": "血圧", "unit": "mmHg",
#         "codings": [{ "system": "http://loinc.org", "code": "85354-9" }],
#         "components": [{ "code": "8480-6", "name": "収縮期" }, { "code": "8462-4", "name": "拡張期" }] },
#       { "key": "template:<id>:edema", "source": "template", "name": "浮腫", "unit": "",
#         "codings": [...], "options": [{ "code": "none", "display": "なし" }, { "code": "mild", "display": "軽度" }] },
#       { "key": "lab:160046810", "source": "lab", "name": "HBs抗原", "unit": "", "scale": "nominal",
#         "codings": [...], "options": [{ "code": "1", "display": "陽性" }, { "code": "2", "display": "陰性" }] } ],
#     "events": ["encounter", "surgery", "adverse"],
#     "drugs": [{ "key": "yj7:3332001", "name": "ワルファリン", "yj7": "3332001", "codes": ["613330003"] }],
#     "overlay": false,
#     "background": { "kind": "item", "key": "template:<id>:edema" } }
#
# codings の中身(どのコード体系のどのコードか)は解釈しない。画面が Observation.code
# と突き合わせるためにそのまま持つだけ(OrderSetEntry#values と同じ考え)。
# drugs の yj7(YJ コードの先頭 7 桁)・codes(レセ電コード)も同じで、形だけを見る。
# background(全レーンに網掛けする行)は items / drugs / events の中を指す参照だが、
# 突き合わせは画面が行う(指す先が無くなっていれば画面が落とす)。
# 設計は docs/patient-chart-design.md。
class ChartDefinition < ApplicationRecord
  SCOPES = %w[facility department practitioner].freeze

  SCHEMA_VERSION = 1
  DEFINITION_KEYS = %w[schema_version axis items events drugs overlay background].freeze
  AXIS_KEYS = %w[unit columns].freeze
  AXIS_UNITS = %w[day month year].freeze
  # 画面が使う範囲(日 7〜92 / 月 3〜36 / 年 1〜10)より広く取る。単位ごとの妥当な
  # 範囲は画面の都合なので、ここでは桁が壊れていないことだけを見る。
  COLUMNS_RANGE = (1..120)
  ITEM_KEYS = %w[key source name unit codings components options scale].freeze
  ITEM_SOURCES = %w[lab vital template].freeze
  # 選択肢の尺度。省略は順序あり(並び順 = 程度)。nominal は順序なし(陽性/陰性など)。
  ITEM_SCALES = %w[ordinal nominal].freeze
  CODING_KEYS = %w[system code display].freeze
  COMPONENT_KEYS = %w[code name].freeze
  OPTION_KEYS = %w[system code display].freeze
  EVENT_KINDS = %w[condition encounter surgery chemo radiotherapy adverse exam injection prescription].freeze
  MAX_ITEMS = 30
  DRUG_KEYS = %w[key name yj7 codes].freeze
  MAX_DRUGS = 20
  BACKGROUND_KEYS = %w[kind key event].freeze
  BACKGROUND_KINDS = %w[item drug event].freeze
  # 網掛けにできるのは期間を持つ種別だけ。
  BACKGROUND_EVENT_KINDS = %w[encounter chemo adverse].freeze

  DEFAULT_DEFINITION = {
    "schema_version" => SCHEMA_VERSION,
    "axis" => { "unit" => "month", "columns" => 12 },
    "items" => [],
    "events" => [],
    "drugs" => [],
    # true なら全項目を 1 つのグラフに重ねる。既定は項目ごとに分けて並べる。
    "overlay" => false,
    "background" => nil
  }.freeze

  # 定義を消したら、それを最初に開くチャートにしていた患者のピンも外す。
  has_many :patient_chart_pins, dependent: :delete_all

  before_validation :assign_code

  validates :code, presence: true, uniqueness: true
  validates :scope, inclusion: { in: SCOPES }
  validates :name, presence: true, uniqueness: { scope: %i[scope owner_id] }
  validate :owner_must_match_scope
  validate :definition_shape

  scope :ordered, -> { order(Arel.sql("display_order NULLS LAST"), :id) }

  # 画面が同時に見る 3 つの持ち主(院内共通 + 指定した診療科 + 指定した医師)。
  # 引数が空の持ち主は含めない(OrderSet.roots_for と同じ)。
  def self.roots_for(department_id:, practitioner_id:)
    rel = where(scope: "facility")
    rel = rel.or(where(scope: "department", owner_id: department_id)) if department_id.present?
    rel = rel.or(where(scope: "practitioner", owner_id: practitioner_id)) if practitioner_id.present?
    rel
  end

  # 欠けたキーを既定値で埋めた定義。読み出しは常にこちらを使う。
  def definition_with_defaults
    stored = definition.is_a?(Hash) ? definition : {}
    DEFAULT_DEFINITION.merge(stored.slice(*DEFINITION_KEYS))
  end

  private

  # code は運用者に入力させず採番する。複製やインポートで指定があれば尊重する。
  def assign_code
    self.code = SecureRandom.uuid if code.blank?
  end

  def owner_must_match_scope
    if scope == "facility"
      errors.add(:owner_id, "は院内共通では指定できません") if owner_id.present?
    elsif owner_id.blank?
      errors.add(:owner_id, "を入力してください")
    end
  end

  def definition_shape
    return if definition.blank?
    return errors.add(:definition, "は連想配列で指定してください") unless definition.is_a?(Hash)

    unknown = definition.keys - DEFINITION_KEYS
    errors.add(:definition, "に対象外の項目があります(#{unknown.join(', ')})") if unknown.any?

    unless definition["schema_version"].nil? || definition["schema_version"] == SCHEMA_VERSION
      errors.add(:definition, "の schema_version は #{SCHEMA_VERSION} のみ使えます")
    end

    validate_axis(definition["axis"])
    validate_items(definition["items"])
    validate_events(definition["events"])
    validate_drugs(definition["drugs"])
    validate_background(definition["background"])

    overlay = definition["overlay"]
    return if overlay.nil? || [true, false].include?(overlay)

    errors.add(:definition, "の overlay は true / false で指定してください")
  end

  def validate_background(background)
    return if background.nil?
    return errors.add(:definition, "の background は連想配列で指定してください") unless background.is_a?(Hash)

    unknown = background.keys - BACKGROUND_KEYS
    errors.add(:definition, "の background に対象外の項目があります(#{unknown.join(', ')})") if unknown.any?

    kind = background["kind"]
    unless BACKGROUND_KINDS.include?(kind)
      return errors.add(:definition, "の background.kind は #{BACKGROUND_KINDS.join(' / ')} のいずれかで指定してください")
    end

    if kind == "event"
      errors.add(:definition, "の background に key は指定できません") if background.key?("key")
      return if BACKGROUND_EVENT_KINDS.include?(background["event"])

      errors.add(:definition, "の background.event は #{BACKGROUND_EVENT_KINDS.join(' / ')} のいずれかで指定してください")
    else
      errors.add(:definition, "の background に event は指定できません") if background.key?("event")
      return if background["key"].is_a?(String) && background["key"].present?

      errors.add(:definition, "の background.key は必須です")
    end
  end

  def validate_axis(axis)
    return if axis.nil?
    return errors.add(:definition, "の axis は連想配列で指定してください") unless axis.is_a?(Hash)

    unknown = axis.keys - AXIS_KEYS
    errors.add(:definition, "の axis に対象外の項目があります(#{unknown.join(', ')})") if unknown.any?

    unless axis["unit"].nil? || AXIS_UNITS.include?(axis["unit"])
      errors.add(:definition, "の axis.unit は #{AXIS_UNITS.join(' / ')} のいずれかで指定してください")
    end
    return if axis["columns"].nil?
    return if axis["columns"].is_a?(Integer) && COLUMNS_RANGE.cover?(axis["columns"])

    errors.add(:definition, "の axis.columns は #{COLUMNS_RANGE.min}〜#{COLUMNS_RANGE.max} の整数で指定してください")
  end

  def validate_items(items)
    return if items.nil?
    return errors.add(:definition, "の items は配列で指定してください") unless items.is_a?(Array)
    return errors.add(:definition, "の items は #{MAX_ITEMS} 件までです") if items.size > MAX_ITEMS

    keys = Set.new
    items.each_with_index { |item, index| validate_item(item, index, keys) }
  end

  def validate_item(item, index, keys)
    label = "の items[#{index}]"
    return errors.add(:definition, "#{label} は連想配列で指定してください") unless item.is_a?(Hash)

    unknown = item.keys - ITEM_KEYS
    errors.add(:definition, "#{label} に対象外の項目があります(#{unknown.join(', ')})") if unknown.any?

    key = item["key"]
    if key.is_a?(String) && key.present?
      errors.add(:definition, "#{label} の key が重複しています") unless keys.add?(key)
    else
      errors.add(:definition, "#{label} の key は必須です")
    end

    unless ITEM_SOURCES.include?(item["source"])
      errors.add(:definition, "#{label} の source は #{ITEM_SOURCES.join(' / ')} のいずれかで指定してください")
    end
    errors.add(:definition, "#{label} の name は必須です") unless item["name"].is_a?(String) && item["name"].present?
    if item.key?("unit") && !item["unit"].is_a?(String)
      errors.add(:definition, "#{label} の unit は文字列で指定してください")
    end
    if item.key?("scale") && !ITEM_SCALES.include?(item["scale"])
      errors.add(:definition, "#{label} の scale は #{ITEM_SCALES.join(' / ')} のいずれかで指定してください")
    end

    validate_codings(item["codings"], label)
    validate_components(item["components"], label)
    validate_options(item["options"], label)
  end

  # テンプレートの選択肢項目の選択肢。並び順を程度の順として画面が使う。
  def validate_options(options, label)
    return if options.nil?
    return errors.add(:definition, "#{label} の options は配列で指定してください") unless options.is_a?(Array)

    options.each_with_index do |option, index|
      unless option.is_a?(Hash)
        next errors.add(:definition, "#{label} の options[#{index}] は連想配列で指定してください")
      end

      unknown = option.keys - OPTION_KEYS
      if unknown.any?
        errors.add(:definition, "#{label} の options[#{index}] に対象外の項目があります(#{unknown.join(', ')})")
      end
      %w[code display].each do |key|
        next if option[key].is_a?(String) && option[key].present?

        errors.add(:definition, "#{label} の options[#{index}].#{key} は必須です")
      end
      if option.key?("system") && !option["system"].is_a?(String)
        errors.add(:definition, "#{label} の options[#{index}].system は文字列で指定してください")
      end
    end
  end

  def validate_codings(codings, label)
    unless codings.is_a?(Array) && codings.any?
      return errors.add(:definition, "#{label} の codings は 1 件以上の配列で指定してください")
    end

    codings.each_with_index do |coding, index|
      unless coding.is_a?(Hash)
        next errors.add(:definition, "#{label} の codings[#{index}] は連想配列で指定してください")
      end

      unknown = coding.keys - CODING_KEYS
      if unknown.any?
        errors.add(:definition, "#{label} の codings[#{index}] に対象外の項目があります(#{unknown.join(', ')})")
      end
      %w[system code].each do |key|
        value = coding[key]
        next if value.is_a?(String) && value.present?

        errors.add(:definition, "#{label} の codings[#{index}].#{key} は必須です")
      end
    end
  end

  def validate_components(components, label)
    return if components.nil?
    return errors.add(:definition, "#{label} の components は配列で指定してください") unless components.is_a?(Array)

    components.each_with_index do |component, index|
      unless component.is_a?(Hash)
        next errors.add(:definition, "#{label} の components[#{index}] は連想配列で指定してください")
      end

      unknown = component.keys - COMPONENT_KEYS
      if unknown.any?
        errors.add(:definition, "#{label} の components[#{index}] に対象外の項目があります(#{unknown.join(', ')})")
      end
      COMPONENT_KEYS.each do |key|
        value = component[key]
        next if value.is_a?(String) && value.present?

        errors.add(:definition, "#{label} の components[#{index}].#{key} は必須です")
      end
    end
  end

  def validate_events(events)
    return if events.nil?
    return errors.add(:definition, "の events は配列で指定してください") unless events.is_a?(Array)

    unknown = events - EVENT_KINDS
    errors.add(:definition, "の events に対象外の種別があります(#{unknown.join(', ')})") if unknown.any?
    errors.add(:definition, "の events が重複しています") if events.size != events.uniq.size
  end

  def validate_drugs(drugs)
    return if drugs.nil?
    return errors.add(:definition, "の drugs は配列で指定してください") unless drugs.is_a?(Array)
    return errors.add(:definition, "の drugs は #{MAX_DRUGS} 件までです") if drugs.size > MAX_DRUGS

    keys = Set.new
    drugs.each_with_index { |drug, index| validate_drug(drug, index, keys) }
  end

  def validate_drug(drug, index, keys)
    label = "の drugs[#{index}]"
    return errors.add(:definition, "#{label} は連想配列で指定してください") unless drug.is_a?(Hash)

    unknown = drug.keys - DRUG_KEYS
    errors.add(:definition, "#{label} に対象外の項目があります(#{unknown.join(', ')})") if unknown.any?

    key = drug["key"]
    if key.is_a?(String) && key.present?
      errors.add(:definition, "#{label} の key が重複しています") unless keys.add?(key)
    else
      errors.add(:definition, "#{label} の key は必須です")
    end
    errors.add(:definition, "#{label} の name は必須です") unless drug["name"].is_a?(String) && drug["name"].present?

    yj7 = drug["yj7"]
    unless yj7.nil? || (yj7.is_a?(String) && yj7.match?(/\A\d{7}\z/))
      errors.add(:definition, "#{label} の yj7 は 7 桁の数字で指定してください")
    end
    codes = drug["codes"]
    unless codes.nil? || (codes.is_a?(Array) && codes.all? { |code| code.is_a?(String) && code.present? })
      errors.add(:definition, "#{label} の codes は文字列の配列で指定してください")
    end
    return if yj7.present? || codes.is_a?(Array) && codes.any?

    errors.add(:definition, "#{label} は yj7 か codes のどちらかが要ります")
  end
end
