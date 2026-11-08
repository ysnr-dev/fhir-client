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
  include ScopedDefinition

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

end
