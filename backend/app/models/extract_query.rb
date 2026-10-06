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
#       { "key": "c3", "kind": "medication", "order_type": "prescription",
#         "drug_classes": [{ "code": "61", "name": "抗生物質製剤" }], "min_count": 2 },
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
  ORDER_TYPES = %w[prescription injection].freeze
  # 出力項目(docs/data-extract-design.md §4)。患者番号・氏名はいつも出す。
  PATIENT_COLUMNS = %w[kana age gender birth_date postal_code address phone patient_id].freeze
  LEAF_OUTPUT_FIELDS = %w[count first last latest].freeze
  MAX_DRUG_CLASSES = 20
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
    "department_name" => :string,
    # 入院の病棟(Location)。入院のベッドから病室・病棟を辿るチェーン検索で絞る。
    "ward_id" => :string,
    "ward_name" => :string,
    # 薬効分類(YJ コードの先頭 2〜4 桁)。実行時に医薬品コードへ展開する(新しい薬も拾える)。
    "drug_classes" => {
      list: {
        fields: { "code" => { pattern: /\A\d{2,4}\z/, label: "数字 2〜4 桁", strict: true }, "name" => :any },
        required: %w[code]
      },
      max: MAX_DRUG_CLASSES,
      unique: "code"
    },
    # 処方・注射の区別(無ければ両方)。オーダーのヘッダの order-type で分ける。
    "order_type" => { enum: ORDER_TYPES },
    # 一覧・CSV に出す項目(件数・最初・最後・最新)。無ければすべて。
    "output_fields" => { list: { enum: LEAF_OUTPUT_FIELDS }, unique: true, min: 1 },
    # 時間関係。同じ AND グループの別の条件(key)の記録の日から from_days〜to_days 日の記録だけを数える
    # (負の日数は前)。anchor_date は基準の記録のどの日か(end は入院・外来の終了日)。
    "relation" => {
      fields: {
        "key" => :text,
        "from_days" => { integer: { min: -3650, max: 3650, unit: "日" } },
        "to_days" => { integer: { min: -3650, max: 3650, unit: "日" } },
        "anchor_date" => { enum: %w[start end] }
      },
      required: %w[key from_days to_days],
      check: lambda { |relation, path|
        from, to = relation.values_at("from_days", "to_days")
        from.is_a?(Integer) && to.is_a?(Integer) && from > to ? ["#{path} は from_days を to_days 以下にしてください"] : []
      }
    }
  }.freeze

  # 葉の種類ごとの決まりごと。
  LEAF_CHECK = lambda { |leaf, path|
    errors = []
    kind = leaf["kind"]
    drug_classes = kind == "medication" ? Array(leaf["drug_classes"]) : []
    if CODE_KINDS.include?(kind) && Array(leaf["codes"]).empty? && drug_classes.empty?
      errors << "#{path}.codes は 1 件以上要ります"
    end
    errors << "#{path}.period は必須です" if PERIOD_REQUIRED_KINDS.include?(kind) && leaf["period"].nil?
    if kind == "patient" && Array(leaf["gender"]).empty? && leaf.dig("age", "min").nil? && leaf.dig("age", "max").nil?
      errors << "#{path} は性別か年齢のどちらかが要ります"
    end
    errors
  }

  # グループの決まりごと(否定と時間関係の置き場所)。
  GROUP_CHECK = lambda { |group, path|
    children = Array(group["children"]).select { |child| child.is_a?(Hash) }
    negated = children.select { |child| child["not"] == true }
    errors = []
    unless negated.empty?
      errors << "#{path} の OR の下には除外の条件を置けません" if group["op"] == "or"
      errors << "#{path} には除外でない条件が 1 つ以上要ります" if negated.size == children.size
    end
    errors + RELATION_CHECK.call(group, children, path)
  }

  # 時間関係の基準は、同じ AND グループの、除外でも患者属性でもなく、自分も時間関係を持たない別の条件。
  RELATION_CHECK = lambda { |group, children, path|
    children.select { |child| child["relation"].is_a?(Hash) }.flat_map do |child|
      next ["#{path} の OR の下には時間関係の条件を置けません"] if group["op"] == "or"

      anchor = children.find { |c| c["kind"] && c["key"] == child.dig("relation", "key") }
      valid = anchor && anchor != child && anchor["not"] != true && anchor["kind"] != "patient" && !anchor["relation"]
      valid ? [] : ["#{path} の #{child['key']} の時間関係の基準が同じグループの条件ではありません"]
    end
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
      "root" => ROOT_SHAPE,
      # 一覧・CSV に出す患者の項目。無ければ既定(年齢・性別・生年月日)。
      "output" => {
        fields: { "patient_columns" => { list: { enum: PATIENT_COLUMNS }, unique: true } }
      }
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

  # 実行の記録(定点観測の推移)。条件を消したら一緒に消す。
  has_many :extract_query_runs, dependent: :delete_all

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
