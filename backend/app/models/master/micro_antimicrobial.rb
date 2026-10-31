module Master
  # 細菌検査結果の薬剤感受性で使う抗菌薬(JANIS 抗菌薬コード)。frequent は結果
  # 画面に直接並べる頻用薬の印で、画面から切り替える(取込では温存する)。
  # 取込は official のみ入れ替え、施設追加分(source=local)は温存する。
  class MicroAntimicrobial < ApplicationRecord
    self.table_name = "master_micro_antimicrobials"

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    include Master::OfficialSource

    before_save :set_search_columns

    scope :frequent, -> { where(frequent: true) }

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_abbreviation = SearchNormalizer.normalize(abbreviation)
    end
  end
end
