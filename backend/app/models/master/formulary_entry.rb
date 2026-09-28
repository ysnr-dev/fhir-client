module Master
  # 薬効群に載せた医薬品 1 件。rank が推奨順位(1 = 第一選択)。
  class FormularyEntry < ApplicationRecord
    self.table_name = "master_formulary_entries"

    belongs_to :group, class_name: "Master::FormularyGroup", foreign_key: :formulary_group_id,
                       inverse_of: :entries

    validates :medicine_code, presence: true, uniqueness: { scope: :formulary_group_id }
    validates :rank, numericality: { only_integer: true, greater_than_or_equal_to: 1 }

    # 医薬品マスタの行。FK は無いので取込で消えていれば nil。
    def medicine
      Master::Medicine.find_by(medicine_code: medicine_code)
    end
  end
end
