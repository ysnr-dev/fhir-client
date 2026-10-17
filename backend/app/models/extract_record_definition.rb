# データ抽出の記録を表にするタブ(テンプレート・検査結果など)で保存する条件の形
# (docs/data-extract-design.md §17)。「患者」タブの条件(ExtractQuery::DEFINITION_SHAPE)と違い、
# AND / OR の木は持たず、タブごとの入力欄の値をそのまま持つ。どのタブの条件かは ExtractQuery#tab。
#
# どのタブにも共通するのは、期間・患者の絞り込み(「患者」タブに保存した条件の code と、患者フォルダ)・
# 比較群と担当医・出力する患者の列。タブ固有の項目は TAB_FIELDS に足す。中身のコード(どの薬・どの検査か)は解釈しない。
module ExtractRecordDefinition
  SCHEMA_VERSION = 1
  TABS = %w[encounter condition template lab medication micro surgery perform adverse pathway cluster indicator event].freeze
  MAX_ITEMS = 50

  CODE_SHAPE = ExtractQuery::CODE_SHAPE
  MAX_STRATA = 8

  # 比較群(§21)・クラスタ(§22)の 1 つ。「患者」タブの条件 1 件(kind。患者属性は置けない)、「患者」タブに保存した
  # 条件の code(query_code)、患者フォルダ(patient_folder_id。下位フォルダを含む)のどれか。label が名前。
  # 除外・時間関係・出力項目は持たない。
  STRATUM_SOURCES = %w[kind query_code patient_folder_id].freeze

  # index_date は基準日(§24。条件型だけ。該当記録の最初 / 最後の日)。
  STRATUM_SHAPE = {
    fields: ExtractQuery::LEAF_FIELDS.except("not", "relation", "output_fields")
                                     .merge("query_code" => :text, "patient_folder_id" => { integer: { min: 1 } },
                                            "index_date" => { enum: %w[first last] }),
    required: %w[key],
    check: lambda { |stratum, path|
      chosen = STRATUM_SOURCES.count { |field| !stratum[field].nil? }
      if chosen != 1
        ["#{path} は条件・保存した条件・患者フォルダのどれか 1 つを指定してください(kind・query_code・patient_folder_id)"]
      elsif stratum["kind"] == "patient"
        ["#{path} に患者属性の条件は置けません"]
      elsif stratum["kind"]
        ExtractQuery::LEAF_CHECK.call(stratum, path)
      elsif stratum.key?("index_date")
        ["#{path} の基準日は条件型の比較群だけに置けます"]
      else
        []
      end
    }
  }.freeze

  # クラスタタブ(§22)の指標の 1 つ。「患者」タブの条件 1 件(患者属性は置けない)。
  MAX_METRICS = 8
  METRIC_SHAPE = {
    fields: ExtractQuery::LEAF_FIELDS.except("not", "relation", "output_fields"),
    required: %w[key kind],
    check: lambda { |metric, path|
      metric["kind"] == "patient" ? ["#{path} に患者属性の条件は置けません"] : ExtractQuery::LEAF_CHECK.call(metric, path)
    }
  }.freeze

  # 指標タブ(§23)の分子。比較群と同じ形だが、患者フォルダは置けない(日付が無く、刻みごとに評価できない)。
  NUMERATOR_SHAPE = STRATUM_SHAPE.merge(
    check: lambda { |stratum, path|
      errors = STRATUM_SHAPE[:check].call(stratum, path)
      errors << "#{path} に患者フォルダは置けません" if stratum.key?("patient_folder_id")
      errors
    }
  ).freeze

  # イベントタブ(§25)の基準イベント。条件 1 件(指標と同じ形)だが、期間はタブの期間で読むので無くてよい
  # (入院・外来の期間必須を、仮の期間を補って通す)。
  EVENT_LEAF_CHECK = lambda { |leaf, path|
    if leaf["kind"] == "patient"
      ["#{path} に患者属性の条件は置けません"]
    else
      ExtractQuery::LEAF_CHECK.call(leaf.merge("period" => leaf["period"] || { "mode" => "relative", "days" => 1 }), path)
    end
  }
  EVENT_INDEX_SHAPE = METRIC_SHAPE.merge(check: EVENT_LEAF_CHECK).freeze

  # 結果イベント。条件 1 件(期間は基準日から決まるので無くてよい)か死亡(kind "death")。
  EVENT_OUTCOME_SHAPE = {
    fields: METRIC_SHAPE[:fields].merge("kind" => { enum: ExtractQuery::KINDS + %w[death] }),
    required: %w[key kind],
    check: lambda { |outcome, path|
      outcome["kind"] == "death" ? [] : EVENT_LEAF_CHECK.call(outcome, path)
    }
  }.freeze

  INDICATOR_GRAINS = %w[year fiscal quarter month].freeze
  TARGET_DIRECTIONS = %w[ge le].freeze

  COMMON_FIELDS = {
    "schema_version" => { const: SCHEMA_VERSION },
    "period" => ExtractQuery::PERIOD_SHAPE,
    # 患者の絞り込み。「患者」タブに保存した条件は環境をまたいでも同じ code で指す。
    "patient_query_code" => :string,
    "patient_folder_id" => { integer: { min: 1 } },
    "output" => {
      fields: { "patient_columns" => { list: { enum: ExtractQuery::PATIENT_COLUMNS }, unique: true } }
    },
    # 比較群と、比較群に入らない患者を除くか(§21)。
    "strata" => { list: STRATUM_SHAPE, max: MAX_STRATA, unique: "key" },
    "strata_only" => :boolean,
    # 担当医の列の決め方(外来の担当医・入院の主治医・処方の依頼医)。
    "attending" => { enum: %w[outpatient inpatient prescriber] },
    # 内訳の切り口(§18)。列は見出しの名前で持つ(中身は解釈しない)。
    "breakdown" => {
      fields: {
        "date" => :string,
        "grain" => { enum: %w[year fiscal quarter month week day elapsed_day elapsed_week elapsed_month] },
        "fill_empty" => :boolean,
        "rows" => :string,
        "columns" => :string,
        "value" => :string,
        "metric" => { enum: %w[sum mean median min max] },
        "show_sub" => :boolean,
        "ratio" => { enum: %w[row column] },
        "split_multi" => :boolean,
        # 数値の列を軸にしたときの区切り(見出しの名前 → 区切りの値の昇順)。
        "bins" => { map: { list: :number, min: 1, max: 20 }, keys: :any }
      }
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
        "aggregates" => { list: { enum: %w[first latest delta max min mean count] }, unique: true, min: 1 },
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
    "pathway" => { fields: { "pathway_code" => :string } },
    "condition" => {
      fields: {
        "codes" => { list: CODE_SHAPE, max: ExtractQuery::MAX_CODES },
        "clinical_status" => { list: { enum: ExtractQuery::CLINICAL_STATUSES }, unique: true },
        "category" => { enum: %w[billing problem past] },
        "suspected" => { enum: %w[exclude only] },
        "date_field" => { enum: ExtractQuery::DATE_FIELDS }
      }
    },
    "encounter" => {
      fields: {
        "kind" => { enum: %w[inpatient outpatient emergency] },
        "date_mode" => { enum: ExtractQuery::DATE_MODES },
        "ward_id" => :string,
        "ward_name" => :string
      }.merge(DEPARTMENT_FIELDS),
      required: %w[kind]
    },
    # クラスタは共通の strata(1 件以上)、比べる指標は metrics。
    "cluster" => {
      fields: {
        "strata" => COMMON_FIELDS["strata"].merge(min: 1),
        "metrics" => { list: METRIC_SHAPE, max: MAX_METRICS, unique: "key" }
      },
      required: %w[strata]
    },
    # 指標(§23)は期間の刻みごとに分母・分子を評価するので、期間の開始が要る。目標は割合(%)。
    "indicator" => {
      fields: {
        "grain" => { enum: INDICATOR_GRAINS },
        "denominator" => STRATUM_SHAPE,
        "numerator" => NUMERATOR_SHAPE,
        "target" => :number,
        "target_direction" => { enum: TARGET_DIRECTIONS }
      },
      required: %w[grain denominator numerator period],
      check: lambda { |definition, path|
        period = definition["period"]
        errors = []
        if period.is_a?(Hash) && period["mode"] == "absolute" && period["from"].nil?
          errors << "#{path || 'definition'}.period は from が要ります"
        end
        target = definition["target"]
        errors << "#{path || 'definition'}.target は 0〜100 にしてください" if target.is_a?(Numeric) && !target.between?(0, 100)
        errors
      }
    },
    # イベント(§25)。基準イベントはタブの期間で読むので期間の開始が要る。
    "event" => {
      fields: {
        "index" => EVENT_INDEX_SHAPE,
        "index_anchor" => { enum: %w[start end] },
        "outcome" => EVENT_OUTCOME_SHAPE,
        "outcome_from_days" => { integer: { min: 0, max: 365, unit: "日" } },
        "follow_days" => { integer: { min: 1, max: 3650, unit: "日" } }
      },
      required: %w[index outcome period],
      check: lambda { |definition, path|
        period = definition["period"]
        if period.is_a?(Hash) && period["mode"] == "absolute" && period["from"].nil?
          ["#{path || 'definition'}.period は from が要ります"]
        else
          []
        end
      }
    }
  }.freeze

  # タブの条件の形(共通の項目 + タブ固有の項目)。
  def self.shape(tab)
    specific = TAB_FIELDS.fetch(tab)
    {
      fields: COMMON_FIELDS.merge(specific[:fields]),
      required: Array(specific[:required]),
      check: specific[:check]
    }
  end

  # 保存値から、そのタブで知っている項目だけを返す(形を変えたときに古い項目を残さない)。
  def self.with_defaults(tab, stored)
    stored = stored.is_a?(Hash) ? stored : {}
    { "schema_version" => SCHEMA_VERSION }.merge(stored.slice(*shape(tab)[:fields].keys))
  end
end
