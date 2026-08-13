module Master
  # 医科診療行為。レセプト電算処理システムの医科診療行為マスター(s_ALL*.csv)の写し。
  # 放射線検査の実施入力で手技料(診療行為)を確定するために使う。
  #
  # FHIR の Procedure リソースとは別物(こちらは点数表のマスタ)。名前が紛らわしいので
  # テーブル・モデルとも medical_ を付けて区別する。
  class MedicalProcedure < ApplicationRecord
    self.table_name = "master_medical_procedures"

    # 廃止年月日は「99999999」= 廃止されていない、を表す(レセ電算の慣行)。
    NOT_ABOLISHED = "99999999".freeze

    validates :procedure_code, presence: true, uniqueness: true

    # 有効な診療行為。廃止済みは選ばせない。
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
