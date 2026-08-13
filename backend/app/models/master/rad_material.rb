module Master
  # 放射線検査で使う器材の施設マスタ。実際に購入している製品を登録し、算定に使う
  # レセプト電算の特定器材コード(Master::MedicalMaterial)を紐付ける。
  # コードで疎結合にしている理由は migration のコメントを参照。
  class RadMaterial < ApplicationRecord
    self.table_name = "master_rad_materials"

    validates :material_code, presence: true, uniqueness: true
    validates :name, presence: true
    validate :valid_period_is_ordered

    # 今日採用している器材(実施入力の選択肢に出すもの)。
    scope :active_on, lambda { |date = Date.current|
      where("valid_from IS NULL OR valid_from <= ?", date)
        .where("valid_to IS NULL OR valid_to >= ?", date)
    }

    before_save :set_search_columns

    # 紐付けているレセプト電算の特定器材。未紐付け・配布マスタ未取込なら nil。
    def receipt_material
      return nil if receipt_material_code.blank?

      Master::MedicalMaterial.find_by(material_code: receipt_material_code)
    end

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は採用開始日以降の日付にしてください")
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
