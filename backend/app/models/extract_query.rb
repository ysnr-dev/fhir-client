# データ抽出の条件 1 件(docs/data-extract-design.md)。
#
# 「どんな患者を抜き出すか」を AND / OR の入れ子で持ち、患者は持たない。抽出の実行は画面が
# 上流 FHIR を引いて行うので、backend は形を確かめて預かるだけ。持ち主(scope / owner_id)は
# チャート定義と同じ 3 段階で、院内共通は owner_id を持たない。
#
# definition は jsonb で、形は次のとおり。
#
#   { "schema_version": 1,
#     "root": { "op": "and", "children": [
#       { "key": "c1", "kind": "condition", "label": "2型糖尿病",
#         "codes": [{ "system": "...", "code": "E11", "display": "2型糖尿病" }],
#         "clinical_status": ["active"], "date_field": "recorded" },
#       { "key": "c2", "kind": "observation", "not": true,
#         "codes": [{ "system": "...", "code": "...", "display": "HbA1c" }],
#         "period": { "mode": "relative", "days": 90 }, "value": { "op": "ge", "value": 8 } },
#       { "op": "or", "children": [ ... ] } ] } }
#
# 葉(kind)は patient / condition / observation / medication / admission / outpatient。
# 否定(not)は AND グループの直下で、否定でない兄弟が 1 つ以上あるときだけ(兄弟の積集合から
# 差を取るため。OR の下や否定だけの AND は全患者の集合が要る)。
# codes の中身(どのコード体系のどのコードか)は解釈しない(ChartDefinition と同じ考え)。
class ExtractQuery < ApplicationRecord
  SCOPES = ChartDefinition::SCOPES

  SCHEMA_VERSION = 1
  MAX_DEPTH = 3
  MAX_LEAVES = 20
  MAX_CODES = 200
  KINDS = %w[patient condition observation medication admission outpatient].freeze
  # 期間を必ず持つ種別(入院・外来は期間なしだと全受診になり、抽出の条件として意味が無い)。
  PERIOD_REQUIRED_KINDS = %w[admission outpatient].freeze
  CODE_KINDS = %w[condition observation medication].freeze
  GENDERS = %w[male female other unknown].freeze
  CLINICAL_STATUSES = %w[active recurrence relapse inactive remission resolved].freeze
  DATE_FIELDS = %w[recorded onset].freeze
  DATE_MODES = %w[overlap admitted discharged].freeze
  VALUE_OPS = %w[ge gt le lt].freeze
  DATE_PATTERN = { pattern: /\A\d{4}-\d{2}-\d{2}\z/, label: " YYYY-MM-DD ", strict: true }.freeze

  PERIOD_SHAPE = {
    fields: {
      "mode" => { enum: %w[absolute relative] },
      "from" => DATE_PATTERN,
      "to" => DATE_PATTERN,
      "days" => { integer: { min: 1, max: 3650, unit: "日" } }
    },
    required: %w[mode],
    check: lambda { |period, path|
      if period["mode"] == "relative"
        period["days"].nil? ? ["#{path}.days は必須です"] : []
      elsif period["from"].nil? && period["to"].nil?
        ["#{path} は from か to のどちらかが要ります"]
      else
        []
      end
    }
  }.freeze

  CODE_SHAPE = {
    fields: { "system" => :text, "code" => :text, "display" => :any },
    required: %w[system code]
  }.freeze

  LEAF_FIELDS = {
    "key" => :text,
    "kind" => { enum: KINDS },
    "label" => :string,
    "not" => :boolean,
    "period" => PERIOD_SHAPE,
    "min_count" => { integer: { min: 1, max: 999, unit: "件" } },
    "codes" => { list: CODE_SHAPE, max: MAX_CODES },
    "gender" => { list: { enum: GENDERS }, unique: true },
    "age" => {
      fields: {
        "min" => { integer: { min: 0, max: 150, unit: "歳" } },
        "max" => { integer: { min: 0, max: 150, unit: "歳" } }
      }
    },
    "clinical_status" => { list: { enum: CLINICAL_STATUSES }, unique: true },
    "date_field" => { enum: DATE_FIELDS },
    "value" => {
      fields: { "op" => { enum: VALUE_OPS }, "value" => :number },
      required: %w[op value]
    },
    "date_mode" => { enum: DATE_MODES },
    "department_id" => :string,
    "department_name" => :string
  }.freeze

  # 葉の種類ごとの決まりごと。
  LEAF_CHECK = lambda { |leaf, path|
    errors = []
    kind = leaf["kind"]
    if CODE_KINDS.include?(kind) && Array(leaf["codes"]).empty?
      errors << "#{path}.codes は 1 件以上要ります"
    end
    errors << "#{path}.period は必須です" if PERIOD_REQUIRED_KINDS.include?(kind) && leaf["period"].nil?
    if kind == "patient" && Array(leaf["gender"]).empty? && leaf.dig("age", "min").nil? && leaf.dig("age", "max").nil?
      errors << "#{path} は性別か年齢のどちらかが要ります"
    end
    errors
  }

  # グループの決まりごと(否定の置き場所)。
  GROUP_CHECK = lambda { |group, path|
    children = Array(group["children"]).select { |child| child.is_a?(Hash) }
    negated = children.select { |child| child["not"] == true }
    next [] if negated.empty?
    next ["#{path} の OR の下には除外の条件を置けません"] if group["op"] == "or"
    next ["#{path} には除外でない条件が 1 つ以上要ります"] if negated.size == children.size

    []
  }

  # ノード(グループか葉)の形。JsonShape は再帰を書けないので、深さごとに展開して作る。
  # 最も深い段には葉しか置けない。
  def self.node_shape(depth)
    group_fields = depth < MAX_DEPTH ? { "op" => { enum: %w[and or] }, "children" => { list: node_shape(depth + 1), min: 1 } } : {}
    {
      fields: LEAF_FIELDS.merge(group_fields),
      check: lambda { |node, path|
        group = node.key?("op") || node.key?("children")
        leaf = node.key?("kind")
        next ["#{path} はグループ(op)か条件(kind)のどちらかです"] if group == leaf
        next(leaf_keys_in_group(node, path) + GROUP_CHECK.call(node, path)) if group
        next ["#{path}.key は必須です"] if node["key"].nil?

        LEAF_CHECK.call(node, path)
      }
    }
  end

  def self.leaf_keys_in_group(node, path)
    extra = node.keys - %w[op children]
    extra.empty? ? [] : ["#{path} のグループには #{extra.join(', ')} を置けません"]
  end

  ROOT_SHAPE = {
    fields: { "op" => { enum: %w[and or] }, "children" => { list: node_shape(2), min: 1 } },
    required: %w[op children],
    check: GROUP_CHECK
  }.freeze

  DEFINITION_SHAPE = {
    fields: {
      "schema_version" => { const: SCHEMA_VERSION },
      "root" => ROOT_SHAPE
    },
    required: %w[root],
    check: lambda { |definition, path|
      leaves = collect_leaves(definition["root"])
      errors = []
      errors << "#{path || 'definition'} の条件は #{MAX_LEAVES} 個までです" if leaves.size > MAX_LEAVES
      keys = leaves.filter_map { |leaf| leaf["key"] }
      errors << "#{path || 'definition'} の条件の key が重なっています" if keys.uniq.size != keys.size
      errors
    }
  }.freeze

  DEFAULT_DEFINITION = {
    "schema_version" => SCHEMA_VERSION,
    "root" => { "op" => "and", "children" => [] }
  }.freeze

  def self.collect_leaves(node)
    return [] unless node.is_a?(Hash)
    return [node] if node.key?("kind")

    Array(node["children"]).flat_map { |child| collect_leaves(child) }
  end

  before_validation :assign_code

  validates :code, presence: true, uniqueness: true
  validates :scope, inclusion: { in: SCOPES }
  validates :name, presence: true, uniqueness: { scope: %i[scope owner_id] }
  validate :owner_must_match_scope
  validate :definition_shape

  scope :ordered, -> { order(Arel.sql("display_order NULLS LAST"), :id) }

  # 画面が同時に見る 3 つの持ち主(ChartDefinition.roots_for と同じ)。
  def self.roots_for(department_id:, practitioner_id:)
    rel = where(scope: "facility")
    rel = rel.or(where(scope: "department", owner_id: department_id)) if department_id.present?
    rel = rel.or(where(scope: "practitioner", owner_id: practitioner_id)) if practitioner_id.present?
    rel
  end

  def definition_with_defaults
    stored = definition.is_a?(Hash) ? definition : {}
    DEFAULT_DEFINITION.merge(stored.slice(*DEFINITION_SHAPE[:fields].keys))
  end

  private

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

    JsonShape.errors(DEFINITION_SHAPE, definition).each do |message|
      errors.add(:definition, message.start_with?("は") ? message : "の #{message}")
    end
  end
end
