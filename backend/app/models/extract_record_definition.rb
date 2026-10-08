# データ抽出の記録を表にするタブ(テンプレート・検査結果など)で保存する条件の形
# (docs/data-extract-design.md §17)。「患者」タブの条件(ExtractQuery::DEFINITION_SHAPE)と違い、
# AND / OR の木は持たず、タブごとの入力欄の値をそのまま持つ。どのタブの条件かは ExtractQuery#tab。
#
# どのタブにも共通するのは、期間・患者の絞り込み(「患者」タブに保存した条件の code と、患者フォルダ)・
# 出力する患者の列。タブ固有の項目は TAB_FIELDS に足す。中身のコード(どの薬・どの検査か)は解釈しない。
module ExtractRecordDefinition
  SCHEMA_VERSION = 1
  TABS = %w[template lab medication micro surgery perform adverse pathway].freeze
  MAX_ITEMS = 50

  CODE_SHAPE = ExtractQuery::CODE_SHAPE

  COMMON_FIELDS = {
    "schema_version" => { const: SCHEMA_VERSION },
    "period" => ExtractQuery::PERIOD_SHAPE,
    # 患者の絞り込み。「患者」タブに保存した条件は環境をまたいでも同じ code で指す。
    "patient_query_code" => :string,
    "patient_folder_id" => { integer: { min: 1 } },
    "output" => {
      fields: { "patient_columns" => { list: { enum: ExtractQuery::PATIENT_COLUMNS }, unique: true } }
    }
  }.freeze

  DEPARTMENT_FIELDS = { "department_id" => :string, "department_name" => :string }.freeze

  # 検査結果の項目(frontend の ChartItem と同じ形)。
  LAB_ITEM_SHAPE = {
    fields: {
      "key" => :text,
      "source" => { enum: %w[lab vital template] },
      "name" => :text,
      "unit" => :string,
      "codings" => { list: { fields: { "system" => :text, "code" => :text, "display" => :any }, required: %w[system code] }, min: 1 },
      "components" => { list: { fields: { "code" => :text, "name" => :text }, required: %w[code name] } },
      "options" => { list: { fields: { "system" => :any, "code" => :text, "display" => :any }, required: %w[code] } },
      "scale" => { enum: %w[ordinal nominal] }
    },
    required: %w[key source name codings]
  }.freeze

  PERFORM_KINDS = (ExtractQuery::PERFORMED_ORDER_KINDS - %w[surgery]).freeze

  TAB_FIELDS = {
    "template" => {
      fields: DEPARTMENT_FIELDS.merge("template_url" => :text, "latest_only" => :boolean),
      required: %w[template_url]
    },
    "lab" => {
      fields: {
        "items" => { list: LAB_ITEM_SHAPE, min: 1, max: MAX_ITEMS, unique: "key" },
        "mode" => { enum: %w[time day patient] },
        "aggregates" => { list: { enum: %w[first latest max min mean count] }, unique: true, min: 1 },
        "interpretation" => :boolean
      }.merge(DEPARTMENT_FIELDS),
      required: %w[items]
    },
    "medication" => {
      fields: {
        "codes" => { list: CODE_SHAPE, max: ExtractQuery::MAX_CODES },
        "drug_classes" => ExtractQuery::LEAF_FIELDS["drug_classes"],
        "order_type" => { enum: ExtractQuery::ORDER_TYPES }
      }.merge(DEPARTMENT_FIELDS)
    },
    "micro" => {
      fields: {
        "include_no_isolate" => :boolean,
        "first_isolate_only" => :boolean,
        "susceptibility" => { list: { enum: %w[sir mic] }, unique: true, min: 1 }
      }
    },
    "surgery" => {
      fields: {
        "procedures" => {
          list: { fields: { "code" => :text, "name" => :any }, required: %w[code] },
          max: MAX_ITEMS,
          unique: "code"
        }
      }.merge(DEPARTMENT_FIELDS)
    },
    "perform" => {
      fields: { "order_kind" => { enum: PERFORM_KINDS } }.merge(DEPARTMENT_FIELDS),
      required: %w[order_kind]
    },
    "adverse" => {
      fields: {
        "treatment_type" => { enum: %w[chemo-regimen radiotherapy] },
        "terms" => { list: :text, unique: true, max: MAX_ITEMS },
        "mode" => { enum: %w[event treatment] }
      }
    },
    "pathway" => { fields: { "pathway_code" => :string } }
  }.freeze

  # タブの条件の形(共通の項目 + タブ固有の項目)。
  def self.shape(tab)
    specific = TAB_FIELDS.fetch(tab)
    {
      fields: COMMON_FIELDS.merge(specific[:fields]),
      required: Array(specific[:required])
    }
  end

  # 保存値から、そのタブで知っている項目だけを返す(形を変えたときに古い項目を残さない)。
  def self.with_defaults(tab, stored)
    stored = stored.is_a?(Hash) ? stored : {}
    { "schema_version" => SCHEMA_VERSION }.merge(stored.slice(*shape(tab)[:fields].keys))
  end
end
