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
#         "components": [{ "code": "8480-6", "name": "収縮期" }, { "code": "8462-4", "name": "拡張期" }] } ],
#     "events": ["encounter", "surgery"],
#     "overlay": false }
#
# codings の中身(どのコード体系のどのコードか)は解釈しない。画面が Observation.code
# と突き合わせるためにそのまま持つだけ(OrderSetEntry#values と同じ考え)。
# 設計は docs/patient-chart-design.md。
class ChartDefinition < ApplicationRecord
  SCOPES = %w[facility department practitioner].freeze

  SCHEMA_VERSION = 1
  DEFINITION_KEYS = %w[schema_version axis items events overlay].freeze
  AXIS_KEYS = %w[unit columns].freeze
  AXIS_UNITS = %w[day month year].freeze
  # 画面が使う範囲(日 7〜92 / 月 3〜36 / 年 1〜10)より広く取る。単位ごとの妥当な
  # 範囲は画面の都合なので、ここでは桁が壊れていないことだけを見る。
  COLUMNS_RANGE = (1..120)
  ITEM_KEYS = %w[key source name unit codings components].freeze
  ITEM_SOURCES = %w[lab vital template].freeze
  CODING_KEYS = %w[system code display].freeze
  COMPONENT_KEYS = %w[code name].freeze
  EVENT_KINDS = %w[encounter surgery chemo radiotherapy exam injection].freeze
  MAX_ITEMS = 30

  DEFAULT_DEFINITION = {
    "schema_version" => SCHEMA_VERSION,
    "axis" => { "unit" => "month", "columns" => 12 },
    "items" => [],
    "events" => [],
    # true なら全項目を 1 つのグラフに重ねる。既定は項目ごとに分けて並べる。
    "overlay" => false
  }.freeze

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

    overlay = definition["overlay"]
    return if overlay.nil? || [true, false].include?(overlay)

    errors.add(:definition, "の overlay は true / false で指定してください")
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

    validate_codings(item["codings"], label)
    validate_components(item["components"], label)
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
end
