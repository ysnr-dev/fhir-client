module Master
  # 投与ステップの中の薬剤 1 件。薬剤マスタを medicine_code で参照する。
  class RegimenDrug < ApplicationRecord
    self.table_name = "master_regimen_drugs"

    # 抗がん剤 / 補液・溶解液 / 制吐剤 / 前投薬 / 支持療法 / その他
    DRUG_ROLES = %w[anticancer fluid antiemetic premedication supportive other].freeze
    # 体表面積(mg/m2) / 体重(mg/kg) / AUC / 固定量(mg/body) / 製剤単位(袋・管…)
    DOSE_BASES = %w[bsa weight auc fixed unit].freeze

    validates :regimen_code, presence: true
    validates :step_id, presence: true
    validates :drug_role, inclusion: { in: DRUG_ROLES }
    validates :medicine_code, presence: true
    validates :dose_basis, inclusion: { in: DOSE_BASES }
    validates :dose_value, numericality: { greater_than: 0 }, allow_nil: true
    validates :dose_max, numericality: { greater_than: 0 }, allow_nil: true
    validate :dose_max_not_below_dose_value

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }

    # 薬剤マスタの名称・薬価算定単位・剤形・YJ コードを添える。FK が無いので
    # LEFT JOIN(参照先が未取込・削除済みでも行は出す)。
    scope :with_names, lambda {
      joins("LEFT JOIN master_medicines ON master_medicines.medicine_code = master_regimen_drugs.medicine_code")
        .select(
          "master_regimen_drugs.*",
          "master_medicines.name AS resolved_name",
          "master_medicines.unit_name AS resolved_unit_name",
          "master_medicines.dosage_form AS dosage_form",
          # 経過措置・削除済みの医薬品は、承認と適用で警告に使う(§8.17)。
          "master_medicines.abolished_on AS abolished_on",
          "master_medicines.transitional_measure_on AS transitional_measure_on",
          "(SELECT hc.individual_medicine_code FROM master_hot_codes hc " \
          "WHERE hc.receipt_code_1 = master_medicines.medicine_code " \
          "AND hc.individual_medicine_code <> '' LIMIT 1) AS yj_code",
        )
    }

    private

    def dose_max_not_below_dose_value
      return if dose_value.blank? || dose_max.blank? || dose_max >= dose_value

      errors.add(:dose_max, "は基準値以上にしてください")
    end
  end
end
