module Master
  # 血液浄化器の施設マスタ。透析オーダーと実施で選ぶ製品を登録し、算定に使う
  # レセプト電算の特定器材コード(Master::MedicalMaterial)を紐付ける。
  # コードで疎結合にしている理由は migration のコメントを参照。
  class BloodPurifier < ApplicationRecord
    self.table_name = "master_blood_purifiers"

    # 画面の選択肢は frontend の BLOOD_PURIFIER_KIND_OPTIONS。
    KINDS = %w[
      dialyzer
      hemodiafilter
      hemofilter
      continuous_filter
      plasma_separator
      plasma_component_separator
      adsorber
    ].freeze

    validates :purifier_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
    validates :membrane_area, numericality: { greater_than: 0, less_than: 100 }, allow_nil: true
    validate :valid_period_is_ordered

    # 今日採用している製品(オーダーと実施の選択肢に出すもの)。
    include Master::ValidityPeriod

    before_save :set_search_columns

    private

    def valid_period_start_label
      "採用開始日"
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
