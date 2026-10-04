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
  AXIS_UNITS = %w[day month year].freeze
  ITEM_SOURCES = %w[lab vital template].freeze
  # 選択肢の尺度。省略は順序あり(並び順 = 程度)。nominal は順序なし(陽性/陰性など)。
  ITEM_SCALES = %w[ordinal nominal].freeze
  EVENT_KINDS = %w[condition encounter surgery chemo radiotherapy adverse exam injection prescription].freeze
  MAX_ITEMS = 30
  MAX_DRUGS = 20
  BACKGROUND_KINDS = %w[item drug event].freeze
  # 網掛けにできるのは期間を持つ種別だけ。
  BACKGROUND_EVENT_KINDS = %w[encounter chemo adverse].freeze

  ITEM_SHAPE = {
    fields: {
      "key" => :text,
      "source" => { enum: ITEM_SOURCES },
      "name" => :text,
      "unit" => :string,
      "scale" => { enum: ITEM_SCALES },
      "codings" => {
        list: { fields: { "system" => :text, "code" => :text, "display" => :any }, required: %w[system code] },
        min: 1
      },
      "components" => { list: { fields: { "code" => :text, "name" => :text }, required: %w[code name] } },
      # テンプレートの選択肢項目の選択肢。並び順を程度の順として画面が使う。
      "options" => {
        list: { fields: { "system" => :string, "code" => :text, "display" => :text }, required: %w[code display] }
      }
    },
    required: %w[key source name codings]
  }.freeze

  DRUG_SHAPE = {
    fields: {
      "key" => :text,
      "name" => :text,
      "yj7" => { pattern: /\A\d{7}\z/, label: " 7 桁の数字", strict: true },
      "codes" => { list: :text }
    },
    required: %w[key name],
    check: lambda { |drug, path|
      next [] if drug["yj7"].present? || (drug["codes"].is_a?(Array) && drug["codes"].any?)

      ["#{path} は yj7 か codes のどちらかが要ります"]
    }
  }.freeze

  # 全レーンに網掛けする行。項目・薬剤は key で、イベントは種別(event)で指す。
  BACKGROUND_SHAPE = {
    fields: { "kind" => { enum: BACKGROUND_KINDS }, "key" => :text, "event" => { enum: BACKGROUND_EVENT_KINDS } },
    required: %w[kind],
    check: lambda { |background, path|
      wanted, unwanted = background["kind"] == "event" ? %w[event key] : %w[key event]
      [
        ("#{path}.#{unwanted} は指定できません" if background.key?(unwanted)),
        ("#{path}.#{wanted} は必須です" if background[wanted].nil?)
      ].compact
    }
  }.freeze

  # definition の形。検証は JsonShape がこの表から回す。
  DEFINITION_SHAPE = {
    fields: {
      "schema_version" => { const: SCHEMA_VERSION },
      "axis" => {
        fields: {
          "unit" => { enum: AXIS_UNITS },
          # 画面が使う範囲(日 7〜92 / 月 3〜36 / 年 1〜10)より広く取る。単位ごとの妥当な
          # 範囲は画面の都合なので、ここでは桁が壊れていないことだけを見る。
          "columns" => { integer: { min: 1, max: 120, unit: "整数" } }
        }
      },
      "items" => { list: ITEM_SHAPE, max: MAX_ITEMS, unique: "key" },
      "events" => { list: { enum: EVENT_KINDS }, unique: true },
      "drugs" => { list: DRUG_SHAPE, max: MAX_DRUGS, unique: "key" },
      "overlay" => :boolean,
      "background" => BACKGROUND_SHAPE
    }
  }.freeze
  DEFINITION_KEYS = DEFINITION_SHAPE[:fields].keys.freeze

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

    # 先頭(definition そのもの)の文言は「は〜」で始まり、中の項目は位置から始まる。
    JsonShape.errors(DEFINITION_SHAPE, definition).each do |message|
      errors.add(:definition, message.start_with?("は") ? message : "の #{message}")
    end
  end
end
