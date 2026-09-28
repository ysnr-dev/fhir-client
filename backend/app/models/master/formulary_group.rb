module Master
  # 院内フォーミュラリの薬効群。群に載せた医薬品を推奨順位付きで持つ。
  class FormularyGroup < ApplicationRecord
    self.table_name = "master_formulary_groups"

    has_many :entries, -> { order(:rank, :id) }, class_name: "Master::FormularyEntry",
                                                  foreign_key: :formulary_group_id, dependent: :destroy,
                                                  inverse_of: :group

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :dosage_form, inclusion: { in: %w[1 4 6 8] }, allow_blank: true

    before_validation :normalize_yakko_codes

    private

    # 空要素と重複を落とす(画面の datalist から来る)。
    def normalize_yakko_codes
      self.yakko_codes = Array(yakko_codes).map(&:to_s).map(&:strip).reject(&:blank?).uniq
    end
  end
end
