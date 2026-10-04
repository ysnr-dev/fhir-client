module Master
  # 標準看護計画。看護診断 1 件に目標と OP(観察)/TP(ケア)/EP(教育)の雛形を結びつける。
  # 看護問題を立てるときに選ぶと、目標と計画の行がフォームへ写る(患者の計画に残るのは写した内容)。
  class NursingStandardPlan < ApplicationRecord
    self.table_name = "master_nursing_standard_plans"

    ACTIVITY_TYPES = %w[op tp ep].freeze
    ITEM_KINDS = %w[act observation].freeze
    GOAL_KEYS = %w[text outcome_code].freeze
    ACTIVITY_KEYS = %w[activity_type text intervention_code item_kind code16 manage_no item_name].freeze

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validate :diagnosis_exists
    validate :activities_shape

    before_validation :normalize_rows
    before_save :set_search_columns

    private

    def normalize_rows
      self.diagnosis_code = diagnosis_code.presence
      self.goals = clean_rows(goals, GOAL_KEYS)
      self.activities = clean_rows(activities, ACTIVITY_KEYS).map do |row|
        next row if ITEM_KINDS.include?(row["item_kind"])

        row.merge("item_kind" => "", "code16" => "", "manage_no" => "", "item_name" => "")
      end
    end

    # 画面から来た行は文字列のまま。文言の無い行を捨て、知らないキーを落とす。
    def clean_rows(rows, keys)
      Array(rows).filter_map do |row|
        next unless row.respond_to?(:to_h)

        cleaned = row.to_h.stringify_keys.slice(*keys).transform_values { |v| v.to_s.strip }
        cleaned if cleaned["text"].present?
      end
    end

    def diagnosis_exists
      return if diagnosis_code.blank?
      return if NursingTerm.terms.where(taxonomy: "diagnosis", code: diagnosis_code).exists?

      errors.add(:diagnosis_code, "は登録済みの看護診断を選んでください")
    end

    def activities_shape
      activities.each do |row|
        errors.add(:activities, "の種類は OP / TP / EP から選んでください") unless ACTIVITY_TYPES.include?(row["activity_type"])
        if row["item_kind"] == "act" && row["code16"].blank?
          errors.add(:activities, "の看護行為のコードがありません")
        elsif row["item_kind"] == "observation" && row["manage_no"].blank?
          errors.add(:activities, "の看護観察のコードがありません")
        end
      end
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
