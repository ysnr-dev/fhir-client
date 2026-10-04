module Master
  # インスリンのスライディングスケールのセット。注射オーダーのスケールの入力で選ぶと行が写る。
  # 行の幅の重なり・抜けはフロントエンドが検証する(オーダーと同じ規則を 1 か所で持つため)。
  # ここでは形だけを見る。
  class InsulinScaleSet < ApplicationRecord
    self.table_name = "master_insulin_scale_sets"

    KINDS = %w[glucose meal free].freeze
    ROW_KEYS = %w[low high dose note condition].freeze

    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
    validate :rows_shape

    before_validation :normalize_rows

    private

    # 画面から来た行は文字列のまま。空の行を捨て、知らないキーを落とす。
    def normalize_rows
      self.rows = Array(rows).filter_map do |row|
        next unless row.respond_to?(:to_h)

        cleaned = row.to_h.stringify_keys.slice(*ROW_KEYS).transform_values { |v| v.to_s.strip }
        cleaned if cleaned.values.any?(&:present?)
      end
    end

    def rows_shape
      if rows.empty?
        errors.add(:rows, "を1行以上入力してください")
        return
      end
      rows.each do |row|
        errors.add(:rows, "の単位は0以上の数値で入力してください") unless numeric?(row["dose"]) && row["dose"].to_f >= 0
        if kind == "free"
          errors.add(:rows, "の条件を入力してください") if row["condition"].blank?
        elsif row["low"].blank? && row["high"].blank?
          errors.add(:rows, "の下限か上限を入力してください")
        end
      end
    end

    def numeric?(value)
      value.present? && Float(value, exception: false)
    end
  end
end
