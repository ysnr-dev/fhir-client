module Master
  # DPC 電子点数表の ICD-10 → 診断群分類上6桁(MDCコード2桁 + 分類コード4桁)の対応表。
  # 配布ファイルそのままの参照表なので、画面からの編集は持たず取込と検索だけを行う。
  class DpcIcdCode < ApplicationRecord
    include DpcEditionScoped

    self.table_name = "master_dpc_icd_codes"

    # 配布ファイルの ICD コード表記ごとの照合方法。
    EXACT = "exact"       # "C700"  そのコードだけ
    PREFIX = "prefix"     # "I50$"  I50 で始まるコードすべて
    FALLBACK = "fallback" # "M!!!!" 表に掲げたコード以外の M コードすべて
    MATCH_TYPES = [EXACT, PREFIX, FALLBACK].freeze

    # 分類コードの末尾は "x" のことがある("01021x")。
    validates :mdc6, presence: true, format: { with: /\A\d{5}[\dx]\z/ }
    validates :icd10, presence: true
    validates :icd_pattern, presence: true
    validates :match_type, inclusion: { in: MATCH_TYPES }

    # 入力された ICD-10 を照合用の表記(半角大文字・小数点なし)にそろえる。
    def self.normalize_icd10(code)
      code.to_s.unicode_normalize(:nfkc).upcase.gsub(/[^A-Z0-9]/, "")
    end

    # ICD-10(複数)に当てはまる行を { ICD-10 => [行, ...] } で返す。
    # 完全一致と前方一致の行を先に探し、どちらも無いコードだけ受け皿の行に落とす。
    # 基準日 on(省略時は今日)の版と、その日に有効な行で引く。
    def self.lookup(codes, on: FacilityClock.today)
      codes = codes.map { |code| normalize_icd10(code) }.reject(&:blank?).uniq
      stems = codes.flat_map { |code| (1..code.size).map { |length| code[0, length] } }.uniq
      candidates = in_edition(Master::DpcEdition.for(on) || latest_edition, on)
                   .where(icd10: stems).order(:id).group_by(&:icd10)

      codes.index_with do |code|
        rows = (1..code.size).flat_map { |length| candidates[code[0, length]] || [] }
        matched = rows.select { |row| row.match_type == PREFIX || (row.match_type == EXACT && row.icd10 == code) }
        matched.presence || rows.select { |row| row.match_type == FALLBACK }
      end
    end

    # 版の記録(master_dpc_editions)が無いまま ICD だけがある場合に備えた版。
    def self.latest_edition
      maximum(:edition)
    end
  end
end
