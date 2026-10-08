module Master
  # 医科点数表の K コードに対応する外保連手術試案の手術基幹コード(STEM7)。厚生労働省が
  # 診療報酬改定のページで配布する対応表(Excel)を取り込み、様式1 の手術基幹コードの候補を引く。
  # 1 つの K コードに複数の STEM7 があり、使い分けは注意点(note)に書かれている。
  class DpcStem7Code < ApplicationRecord
    self.table_name = "master_dpc_stem7_codes"

    validates :k_code, presence: true
    validates :stem7, presence: true, format: { with: /\A[0-9A-Z]{7}\z/ }

    # 細目の全角カナ(配布ファイルの書き方)→ 半角カナ(様式1・診療行為マスタの書き方)。
    # 配布ファイルには「ニ」を漢字の「二」で書いた行がある。
    SUBITEM_KANA = {
      "イ" => "ｲ", "ロ" => "ﾛ", "ハ" => "ﾊ", "ニ" => "ﾆ", "二" => "ﾆ", "ホ" => "ﾎ", "ヘ" => "ﾍ",
      "ト" => "ﾄ", "チ" => "ﾁ", "リ" => "ﾘ", "ヌ" => "ﾇ"
    }.freeze

    # 点数表コードを様式1 の書き方(空白なし・英数字と括弧は半角・細目は半角カナ)にそろえる。
    # "K082 1 ｲ" → "K0821ｲ"、"K426-2 3" → "K426-23"、"K920 3 イ (1)" → "K9203ｲ(1)"。
    def self.normalize_k_code(code)
      halfwidth = code.to_s.tr("０-９Ａ-Ｚａ-ｚ（）－ー‐", "0-9A-Za-z()---")
      halfwidth.gsub(/[[:space:]]/, "").gsub(/[#{SUBITEM_KANA.keys.join}]/o, SUBITEM_KANA).upcase
    end

    # STEM7 を空白を詰めた 7 桁にする("B28 34 04" → "B283404")。
    def self.normalize_stem7(code)
      code.to_s.unicode_normalize(:nfkc).gsub(/[[:space:]]/, "").upcase
    end
  end
end
