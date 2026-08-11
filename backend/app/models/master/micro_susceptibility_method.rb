module Master
  # 細菌検査結果の薬剤感受性の検査方法(JANIS 薬剤感受性検査測定法コード)。
  # 取込は official のみ入れ替え、施設追加分(source=local)は温存する。
  class MicroSusceptibilityMethod < ApplicationRecord
    self.table_name = "master_micro_susceptibility_methods"

    OFFICIAL = "official".freeze
    LOCAL = "local".freeze
    SOURCES = [OFFICIAL, LOCAL].freeze

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :source, inclusion: { in: SOURCES }

    before_save :set_search_columns

    scope :official, -> { where(source: OFFICIAL) }
    scope :local, -> { where(source: LOCAL) }

    def official?
      source == OFFICIAL
    end

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
    end
  end
end
