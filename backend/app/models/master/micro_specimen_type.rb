module Master
  # 細菌検査オーダーの検体種別(JANIS 材料コード)。取込は official のみ
  # 入れ替え、施設追加分(source=local)は温存する。
  class MicroSpecimenType < ApplicationRecord
    self.table_name = "master_micro_specimen_types"

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    include Master::OfficialSource

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize([name, category].compact.join)
    end
  end
end
