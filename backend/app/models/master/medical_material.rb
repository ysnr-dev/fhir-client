module Master
  # 特定器材(特定保険医療材料)。レセプト電算処理システムの特定器材マスター
  # (t_ALL*.csv)の写し。放射線検査の実施入力で使った器材を選ぶために使う。
  class MedicalMaterial < ApplicationRecord
    self.table_name = "master_medical_materials"

    # 廃止年月日は「99999999」= 廃止されていない、を表す(レセ電算の慣行)。
    NOT_ABOLISHED = "99999999".freeze

    validates :material_code, presence: true, uniqueness: true

    # 有効な器材。廃止済みは選ばせない。
    scope :active, -> { where(abolished_on: [nil, "", NOT_ABOLISHED]) }

    before_save :set_search_columns

    def abolished?
      abolished_on.present? && abolished_on != NOT_ABOLISHED
    end

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
