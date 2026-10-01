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

    # 点数表コード(「K0821」「K082-21」「K4073ｲ」)。DPC 様式1 の手術情報などに書く形。
    # 配布マスタの点数表区分番号があればそれを使い、空のときはコード表用番号の
    # 区分番号(3 桁)・枝番(00 は無し)・項番(000 は無し)から組む。区分番号が
    # 000(通則の加算など、特定の区分に属さない行)や章が英字でない行は nil。
    def k_code
      return point_table_section_number if point_table_section_number.present?
      return nil unless code_table_number_alpha.to_s.match?(/\A[A-Z]\z/)
      return nil unless code_table_section.to_s.match?(/\A\d{3}\z/) && code_table_section != "000"

      branch = code_table_branch.to_i
      item = code_table_item.to_i
      "#{code_table_number_alpha}#{code_table_section}#{"-#{branch}" if branch.positive?}#{item if item.positive?}"
    end

    # 一覧の応答に点数表コードを添える。
    def serializable_hash(options = nil)
      super.merge("k_code" => k_code)
    end

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
