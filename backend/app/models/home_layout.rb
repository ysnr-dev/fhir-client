# ホームに並べるカード(docs/features/home.md)。医療従事者ごとに 1 つで、無ければ職種の既定で出す。
#
# definition は jsonb で、形は次のとおり。
#
#   { "schema_version": 1,
#     "cards": [ { "id": "…uuid…", "kind": "worklist", "settings": { "worklist": "lab" } } ] }
#
# 並び順は配列の順。kind の一覧とカードごとの settings の意味はフロントの registry
# (frontend/src/fhir/homeCards.ts)が正典で、ここでは形だけを守る(知らない kind は画面が落とす)。
class HomeLayout < ApplicationRecord
  SCHEMA_VERSION = 1
  MAX_CARDS = 30

  CARD_SHAPE = {
    fields: {
      "id" => :text,
      "kind" => :text,
      "settings" => { map: :any, keys: :any }
    },
    required: %w[id kind]
  }.freeze

  DEFINITION_SHAPE = {
    fields: {
      "schema_version" => { const: SCHEMA_VERSION },
      "cards" => { list: CARD_SHAPE, max: MAX_CARDS, unique: "id" }
    },
    required: %w[cards]
  }.freeze
  DEFINITION_KEYS = DEFINITION_SHAPE[:fields].keys.freeze

  DEFAULT_DEFINITION = { "schema_version" => SCHEMA_VERSION, "cards" => [] }.freeze

  validates :practitioner_id, presence: true, uniqueness: true
  validate :definition_shape

  def definition_with_defaults
    stored = definition.is_a?(Hash) ? definition : {}
    DEFAULT_DEFINITION.merge(stored.slice(*DEFINITION_KEYS))
  end

  private

  def definition_shape
    unless definition.is_a?(Hash)
      errors.add(:definition, "は連想配列で指定してください")
      return
    end

    JsonShape.errors(DEFINITION_SHAPE, definition).each do |message|
      errors.add(:definition, message.start_with?("は") ? message : "の #{message}")
    end
  end
end
