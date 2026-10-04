module Master
  # 看護計画の用語(看護診断・看護成果・看護介入)。1 行が領域・類・用語のどれか。
  # 階層は parent_code で辿る(用語 → 類 → 領域)。
  class NursingTerm < ApplicationRecord
    self.table_name = "master_nursing_terms"

    TAXONOMIES = %w[diagnosis outcome intervention].freeze
    LEVELS = %w[domain class term].freeze
    DIAGNOSIS_TYPES = %w[problem risk health_promotion].freeze
    SOURCES = %w[local licensed].freeze
    ITEM_TYPES = {
      "diagnosis" => %w[defining_characteristic related_factor risk_factor],
      "outcome" => %w[indicator],
      "intervention" => %w[activity]
    }.freeze
    ITEM_KEYS = %w[item_type code name].freeze

    validates :taxonomy, inclusion: { in: TAXONOMIES }
    validates :level, inclusion: { in: LEVELS }
    validates :code, presence: true, uniqueness: { scope: :taxonomy }
    validates :name, presence: true
    validates :source, inclusion: { in: SOURCES }
    validates :diagnosis_type, inclusion: { in: DIAGNOSIS_TYPES }, allow_nil: true
    validate :parent_matches_level
    validate :items_shape

    before_validation :normalize_fields
    before_save :set_search_columns

    scope :terms, -> { where(level: "term") }

    # この行の下に類・用語があるか(領域・類の削除を止めるため)。
    def children?
      level != "term" && self.class.where(taxonomy: taxonomy, parent_code: code).exists?
    end

    private

    def normalize_fields
      self.parent_code = nil if parent_code.blank? || level == "domain"
      self.diagnosis_type = nil if diagnosis_type.blank? || taxonomy != "diagnosis" || level != "term"
      self.items = level == "term" ? normalized_items : []
    end

    # 画面から来た行は文字列のまま。空の行を捨て、知らないキーを落とす。
    def normalized_items
      Array(items).filter_map do |row|
        next unless row.respond_to?(:to_h)

        cleaned = row.to_h.stringify_keys.slice(*ITEM_KEYS).transform_values { |v| v.to_s.strip }
        cleaned if cleaned["name"].present?
      end
    end

    def parent_matches_level
      return if level == "domain"

      parent_level = level == "class" ? "domain" : "class"
      return if parent_code.present? &&
                self.class.where(taxonomy: taxonomy, level: parent_level, code: parent_code).exists?

      errors.add(:parent_code, level == "class" ? "は登録済みの領域を選んでください" : "は登録済みの類を選んでください")
    end

    def items_shape
      allowed = ITEM_TYPES.fetch(taxonomy, [])
      return if items.all? { |row| allowed.include?(row["item_type"]) }

      errors.add(:items, "の種類が正しくありません")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
