module Master
  # 約束処方。名称・基準量と、基準量あたりの構成薬(items)を持つ。
  class PromisedPrescription < ApplicationRecord
    include Master::ValidityPeriod

    self.table_name = "master_promised_prescriptions"

    has_many :items, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) },
             class_name: "Master::PromisedPrescriptionItem", foreign_key: :promised_prescription_id,
             dependent: :destroy, inverse_of: :promised_prescription, autosave: true

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :unit_name, presence: true
    validates :base_amount, numericality: { greater_than: 0 }
    validate :valid_period_is_ordered
    validate :medicines_are_distinct

    before_save :set_search_columns

    private

    def medicines_are_distinct
      codes = items.reject(&:marked_for_destruction?).map(&:medicine_code)
      errors.add(:base, "同じ医薬品を二度登録できません") if codes.uniq.size != codes.size
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
