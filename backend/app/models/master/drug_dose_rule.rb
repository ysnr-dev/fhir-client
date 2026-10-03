module Master
  # 用量と患者条件(年齢・腎機能・体重)の規則。docs/drug-check-master-design.md
  class DrugDoseRule < ApplicationRecord
    self.table_name = "master_drug_dose_rules"

    SEVERITIES = %w[contraindicated caution].freeze
    RENAL_INDEXES = %w[egfr ccr].freeze

    before_validation :normalize

    validates :code, presence: true, format: { with: DrugInteraction::CODE_FORMAT, message: "は YJ コードの先頭 4〜7 桁で入力してください" }
    validates :name, presence: true
    validates :severity, inclusion: { in: SEVERITIES }
    validates :dosage_form, inclusion: { in: %w[1 4 6] }, allow_blank: true
    validates :renal_index, inclusion: { in: RENAL_INDEXES }, allow_blank: true
    validates :age_from, :age_to, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
    validates :renal_below, :max_single_dose, :max_daily_dose, numericality: { greater_than: 0 }, allow_nil: true
    validate :consistent_conditions

    private

    def normalize
      self.code = code.to_s.strip.upcase
      self.dose_unit = dose_unit.to_s.strip.presence
      self.dosage_form = dosage_form.presence
      self.renal_index = renal_index.presence
      self.message = message.to_s.strip.presence
    end

    def consistent_conditions
      if age_from && age_to && age_from >= age_to
        errors.add(:age_to, "は下限より大きくしてください")
      end
      if renal_index.present? != renal_below.present?
        errors.add(:renal_below, "は腎機能の指標とあわせて入力してください")
      end

      has_limit = max_single_dose.present? || max_daily_dose.present?
      errors.add(:dose_unit, "を入力してください") if has_limit && dose_unit.blank?
      errors.add(:per_kg, "は上限とあわせて指定してください") if per_kg && !has_limit

      # 条件も上限も無い規則は、その薬を選ぶたびに出るだけになる。
      has_condition = age_from || age_to || renal_index.present?
      if !has_condition && !has_limit
        errors.add(:base, "年齢・腎機能の条件か用量の上限のどれかを入力してください")
      end
      if !has_limit && message.blank?
        errors.add(:message, "を入力してください(上限が無い規則は文言だけを出します)")
      end
    end
  end
end
