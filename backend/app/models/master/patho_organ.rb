module Master
  # 病理検査オーダーの臓器・検査材料(JAHIS 病理・臨床細胞データ交換規約 付録-3
  # テーブル LPATHO003)。frequent はオーダー画面に直接並べる頻用臓器の印で、
  # 画面から切り替える(取込では温存する)。
  # 取込は official のみ入れ替え、施設追加分(source=local)は温存する。
  class PathoOrgan < ApplicationRecord
    self.table_name = "master_patho_organs"

    OFFICIAL = "official".freeze
    LOCAL = "local".freeze
    SOURCES = [OFFICIAL, LOCAL].freeze

    validates :code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :source, inclusion: { in: SOURCES }

    before_save :set_search_columns

    scope :official, -> { where(source: OFFICIAL) }
    scope :local, -> { where(source: LOCAL) }
    scope :frequent, -> { where(frequent: true) }

    def official?
      source == OFFICIAL
    end

    private

    def set_search_columns
      # ICD-10 も検索対象に含める(「C16」で胃の材料をまとめて絞る使い方)。
      # 検索側は SearchNormalizer で小文字化されるので、カラム側も同じ正規化を通す
      # (生の icd10 列を LIKE すると大文字のままで一致しない)。
      self.search_name = SearchNormalizer.normalize([name, icd10].compact_blank.join(" "))
    end
  end
end
