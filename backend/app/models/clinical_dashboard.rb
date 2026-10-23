# 診療ダッシュボード 1 件(docs/clinical-dashboard-design.md)。
#
# カルテ左ペインのタブ(経過表・検体検査・投薬歴・カルテのタイムラインなど)を、カードとして
# どこにどの大きさで並べるかだけを持つ。患者のデータは持たず、画面が開いた患者で各カードを描く。
# 持ち主(scope / owner_id)はダッシュボードと同じ形だが、院内共通・診療科・医師の 3 つだけ。
#
# definition は jsonb で、形は次のとおり。
#
#   { "schema_version": 1,
#     "cards": [
#       { "id": "c1", "kind": "flowsheet", "title": "経過表",
#         "x": 0, "y": 0, "w": 12, "h": 8, "zoom": 80 } ] }
#
# 位置と大きさはマス(横 12 列、縦は 1 マスの高さ)の整数。kind はカルテのタブのキーで、
# 一覧は画面(karteUrl.ts の KARTE_TABS)にしか無いので値は見ない(知らない種別は画面が
# 「表示できません」と出す)。zoom はカードの中身の表示倍率(%)で、無ければ 100。
class ClinicalDashboard < ApplicationRecord
  SCOPES = %w[facility department practitioner].freeze
  SCHEMA_VERSION = 1
  COLUMNS = 12
  MAX_CARDS = 20
  MAX_ROWS = 200
  MIN_ZOOM = 50

  CARD_SHAPE = {
    fields: {
      "id" => :text,
      "kind" => :text,
      "title" => :string,
      "x" => { integer: { min: 0, max: COLUMNS - 1, unit: "列" } },
      "y" => { integer: { min: 0, max: MAX_ROWS, unit: "行" } },
      "w" => { integer: { min: 1, max: COLUMNS, unit: "列" } },
      "h" => { integer: { min: 1, max: MAX_ROWS, unit: "行" } },
      "zoom" => { integer: { min: MIN_ZOOM, max: 100, unit: "%" } }
    },
    required: %w[id kind x y w h],
    check: lambda { |card, path|
      x, w = card.values_at("x", "w")
      x.is_a?(Integer) && w.is_a?(Integer) && x + w > COLUMNS ? ["#{path} は右端(#{COLUMNS} 列)をはみ出しています"] : []
    }
  }.freeze

  DEFINITION_SHAPE = {
    fields: {
      "schema_version" => { const: SCHEMA_VERSION },
      "cards" => { list: CARD_SHAPE, max: MAX_CARDS, unique: "id" }
    }
  }.freeze
  DEFINITION_KEYS = DEFINITION_SHAPE[:fields].keys.freeze

  DEFAULT_DEFINITION = { "schema_version" => SCHEMA_VERSION, "cards" => [] }.freeze

  before_validation :assign_code

  validates :code, presence: true, uniqueness: true
  validates :scope, inclusion: { in: SCOPES }
  validates :name, presence: true, uniqueness: { scope: %i[scope owner_id] }
  validate :owner_must_match_scope
  validate :definition_shape

  scope :ordered, -> { order(Arel.sql("display_order NULLS LAST"), :id) }

  # 画面が同時に見る持ち主。チームは持たないので team_ids は受けるだけで使わない
  # (ScopedDefinitions#index が常に渡してくる)。
  def self.roots_for(department_id:, practitioner_id:, team_ids: [])
    rel = where(scope: "facility")
    rel = rel.or(where(scope: "department", owner_id: department_id)) if department_id.present?
    rel = rel.or(where(scope: "practitioner", owner_id: practitioner_id)) if practitioner_id.present?
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
