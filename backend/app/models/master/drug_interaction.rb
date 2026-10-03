module Master
  # 薬剤の相互作用(併用禁忌・併用注意)。docs/drug-check-master-design.md
  class DrugInteraction < ApplicationRecord
    self.table_name = "master_drug_interactions"

    SEVERITIES = %w[contraindicated caution].freeze
    # YJ コードの先頭 4〜7 桁(薬効分類 4 桁 + 成分 3 桁)。
    CODE_FORMAT = /\A\d{4}[0-9A-Z]{0,3}\z/

    before_validation :normalize_codes

    validates :code_a, :code_b, presence: true, format: { with: CODE_FORMAT, message: "は YJ コードの先頭 4〜7 桁で入力してください" }
    validates :name_a, :name_b, presence: true
    validates :severity, inclusion: { in: SEVERITIES }
    validate :distinct_pair

    private

    def normalize_codes
      self.code_a = code_a.to_s.strip.upcase
      self.code_b = code_b.to_s.strip.upcase
    end

    # 同じ組み合わせは向きを問わず 1 件だけ(A-B と B-A を別々に持たない)。
    def distinct_pair
      return if code_a.blank? || code_b.blank?

      if code_a == code_b
        errors.add(:code_b, "は相手と別の薬にしてください")
        return
      end
      duplicate = self.class.where(code_a: code_a, code_b: code_b)
                      .or(self.class.where(code_a: code_b, code_b: code_a))
                      .where.not(id: id)
      errors.add(:base, "同じ組み合わせが登録済みです") if duplicate.exists?
    end
  end
end
