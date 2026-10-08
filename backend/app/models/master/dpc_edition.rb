module Master
  # 取り込んだ DPC 電子点数表の版。版は改定の開始日(YYYYMMDD)。
  class DpcEdition < ApplicationRecord
    self.table_name = "master_dpc_editions"

    validates :edition, presence: true, uniqueness: true, format: { with: /\A\d{8}\z/ }

    def self.day_string(date)
      date.respond_to?(:strftime) ? date.strftime("%Y%m%d") : date.to_s.delete("-")
    end

    # 基準日に使う版。基準日以前に始まる版のうち最新のもの。どの版より前の日なら
    # 最も古い版(取込の無い年度の入院でも判定を止めないため)。版が 1 つも無ければ nil。
    def self.for(date = FacilityClock.today)
      day = day_string(date)
      where(edition: ..day).order(edition: :desc).pick(:edition) || order(:edition).pick(:edition)
    end
  end
end
