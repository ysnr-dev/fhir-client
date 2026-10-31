module Master
  # 細菌検査オーダーの目的菌(JANIS 感染症病原体コード)。frequent はオーダー
  # 画面に直接並べる頻用菌の印で、画面から切り替える(取込では温存する)。
  # 取込は official のみ入れ替え、施設追加分(source=local)は温存する。
  class MicroOrganism < ApplicationRecord
    self.table_name = "master_micro_organisms"

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    include Master::OfficialSource

    before_save :set_search_columns

    scope :frequent, -> { where(frequent: true) }

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
    end
  end
end
