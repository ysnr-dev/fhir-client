# ダッシュボード 1 件(docs/dashboard-design.md)。
#
# データ抽出の保存した条件を、タイルとしてどこにどう見せるかだけを持つ。条件の中身は持たず
# code で指す(条件を直せばそのまま効く)。実行は画面が行い、結果は残さない。
# 持ち主(scope / owner_id)はデータ抽出の条件と同じで、院内共通は owner_id を持たない。
#
# definition は jsonb で、形は次のとおり。
#
#   { "schema_version": 1,
#     "tiles": [
#       { "id": "t1", "query_code": "…uuid…", "view": "count", "title": "糖尿病で HbA1c 8 以上",
#         "x": 0, "y": 0, "w": 3, "h": 2 } ] }
#
# 位置と大きさはマス(横 12 列、縦は 1 マスの高さ)の整数。query_code の存在は見ない
# (消した条件のタイルは画面が「条件が見つかりません」と出す)。
class Dashboard < ApplicationRecord
  SCOPES = ChartDefinition::SCOPES
  SCHEMA_VERSION = 1
  COLUMNS = 12
  MAX_TILES = 40
  MAX_ROWS = 200
  VIEWS = %w[count breakdown list].freeze

  TILE_SHAPE = {
    fields: {
      "id" => :text,
      "query_code" => :text,
      "view" => { enum: VIEWS },
      "title" => :string,
      "x" => { integer: { min: 0, max: COLUMNS - 1, unit: "列" } },
      "y" => { integer: { min: 0, max: MAX_ROWS, unit: "行" } },
      "w" => { integer: { min: 1, max: COLUMNS, unit: "列" } },
      "h" => { integer: { min: 1, max: MAX_ROWS, unit: "行" } }
    },
    required: %w[id query_code view x y w h],
    check: lambda { |tile, path|
      x, w = tile.values_at("x", "w")
      x.is_a?(Integer) && w.is_a?(Integer) && x + w > COLUMNS ? ["#{path} は右端(#{COLUMNS} 列)をはみ出しています"] : []
    }
  }.freeze

  DEFINITION_SHAPE = {
    fields: {
      "schema_version" => { const: SCHEMA_VERSION },
      "tiles" => { list: TILE_SHAPE, max: MAX_TILES, unique: "id" }
    }
  }.freeze
  DEFINITION_KEYS = DEFINITION_SHAPE[:fields].keys.freeze

  DEFAULT_DEFINITION = { "schema_version" => SCHEMA_VERSION, "tiles" => [] }.freeze

  before_validation :assign_code

  validates :code, presence: true, uniqueness: true
  validates :scope, inclusion: { in: SCOPES }
  validates :name, presence: true, uniqueness: { scope: %i[scope owner_id] }
  validate :owner_must_match_scope
  validate :definition_shape

  scope :ordered, -> { order(Arel.sql("display_order NULLS LAST"), :id) }

  # 画面が同時に見る持ち主(ChartDefinition.roots_for と同じ)。
  def self.roots_for(department_id:, practitioner_id:, team_ids: [])
    rel = where(scope: "facility")
    rel = rel.or(where(scope: "department", owner_id: department_id)) if department_id.present?
    rel = rel.or(where(scope: "practitioner", owner_id: practitioner_id)) if practitioner_id.present?
    rel = rel.or(where(scope: "team", owner_id: team_ids)) if team_ids.present?
    rel
  end

  def definition_with_defaults
    stored = definition.is_a?(Hash) ? definition : {}
    DEFAULT_DEFINITION.merge(stored.slice(*DEFINITION_KEYS))
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
