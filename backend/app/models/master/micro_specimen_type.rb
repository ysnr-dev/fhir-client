module Master
  # 細菌検査オーダーの検体種別(JANIS 材料コード)。取込は official のみ
  # 入れ替え、施設追加分(source=local)は温存する。
  class MicroSpecimenType < ApplicationRecord
    self.table_name = "master_micro_specimen_types"

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
      self.search_name = SearchNormalizer.normalize([name, category].compact.join)
    end
  end
end
