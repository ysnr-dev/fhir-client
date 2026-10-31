module Master
  # 標準コード表から取り込む行(source=official)と施設が足した行(source=local)を 1 つのテーブルに
  # 持つマスタ。取込は official だけを入れ替え、local は温存する。official の行は画面から
  # code と source を変えられない(コントローラ側は Master::OfficialLocalRecords)。
  module OfficialSource
    extend ActiveSupport::Concern

    OFFICIAL = "official".freeze
    LOCAL = "local".freeze
    SOURCES = [OFFICIAL, LOCAL].freeze

    included do
      validates :source, inclusion: { in: SOURCES }

      scope :official, -> { where(source: OFFICIAL) }
      scope :local, -> { where(source: LOCAL) }
    end

    def official?
      source == OFFICIAL
    end
  end
end
