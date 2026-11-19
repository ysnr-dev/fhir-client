module Master
  # 約束処方の構成薬。量は約束処方の基準量あたり。
  class PromisedPrescriptionItem < ApplicationRecord
    self.table_name = "master_promised_prescription_items"

    belongs_to :promised_prescription, class_name: "Master::PromisedPrescription", inverse_of: :items

    validates :medicine_code, presence: true
    validates :amount, numericality: { greater_than: 0 }
  end
end
