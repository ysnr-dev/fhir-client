module Master
  # 病名と薬の禁忌・注意。docs/drug-check-master-design.md
  class DrugDiseaseRule < ApplicationRecord
    self.table_name = "master_drug_disease_rules"

    SEVERITIES = %w[contraindicated caution].freeze
    # ICD-10 の先頭 3〜5 文字(I50、N18.5 は N185)。
    DISEASE_CODE_FORMAT = /\A[A-Z]\d{2}[0-9A-Z]{0,2}\z/

    before_validation :normalize_codes

    validates :code, presence: true, format: { with: DrugInteraction::CODE_FORMAT, message: "は YJ コードの先頭 4〜7 桁で入力してください" }
    validates :disease_code, presence: true, format: { with: DISEASE_CODE_FORMAT, message: "は ICD-10 の先頭 3〜5 文字で入力してください" }
    validates :disease_code, uniqueness: { scope: :code, message: "は同じ薬で登録済みです" }
    validates :name, :disease_name, presence: true
    validates :severity, inclusion: { in: SEVERITIES }

    private

    def normalize_codes
      self.code = code.to_s.strip.upcase
      self.disease_code = disease_code.to_s.strip.upcase.delete(".")
    end
  end
end
