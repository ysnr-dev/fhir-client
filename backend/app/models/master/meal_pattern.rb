module Master
  # パターン食。術後の食上げ(流動食 → 三分粥 → 五分粥 → 全粥 → 常食)や検査前の食事
  # (低残渣食 → 食止め)のように段階的に変わる食事の雛形。オーダー画面で選ぶと、段階ごとの
  # 食事オーダーが食数で刻んだ期間でまとめて立つ(docs/meal-order-design.md §2.11)。
  #
  # 段階(steps)は食事オーダーのフォーム値の部分集合 + 食数(meals)で、オーダーセットの
  # values と同じく中身はフロントエンドが解釈する。ここでは形だけを見る。
  class MealPattern < ApplicationRecord
    self.table_name = "master_meal_patterns"

    STEP_KEYS = %w[meals diet dietIsFasting staples sideDishForm saltLimit fastingReason comment].freeze

    validates :pattern_code, presence: true, uniqueness: true
    validates :name, presence: true
    validate :steps_shape

    before_validation :normalize_steps
    before_save :set_search_columns

    private

    # 知らないキーを落とし、食数は整数か nil に揃える(画面からは文字列で届くことがある)。
    def normalize_steps
      self.steps = Array(steps).filter_map do |step|
        next unless step.respond_to?(:to_h)

        cleaned = step.to_h.stringify_keys.slice(*STEP_KEYS)
        cleaned["meals"] = normalize_meals(cleaned["meals"])
        cleaned
      end
    end

    def normalize_meals(value)
      return nil if value.blank?

      Integer(value.to_s, exception: false) || value
    end

    def steps_shape
      if steps.empty?
        errors.add(:steps, "を1段階以上入力してください")
        return
      end
      steps.each_with_index do |step, index|
        errors.add(:steps, "の#{index + 1}段階目に食種がありません") if step.dig("diet", "code").blank?
        meals = step["meals"]
        if meals.nil?
          # 食数を空にできる(次の指示まで継続)のは最後の段階だけ。途中で空だと次の段階の開始が決まらない。
          errors.add(:steps, "の#{index + 1}段階目の食数を入力してください") unless index == steps.size - 1
        elsif !meals.is_a?(Integer) || meals < 1
          errors.add(:steps, "の#{index + 1}段階目の食数は1以上の整数で入力してください")
        end
      end
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
