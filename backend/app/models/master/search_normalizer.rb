module Master
  # 名称検索の表記ゆれ吸収。保存時(search_name/search_kana カラム)と検索時
  # (クエリのトークン化)で同じ正規化を通すことで、
  # ひらがな/カタカナ・全角/半角・大文字/小文字の違いを無視して一致させる。
  module SearchNormalizer
    # NFKC で全角英数→半角・半角カナ→全角カナなどを畳み込む。
    # 中点(・)は NFKC 後の表記。空白と合わせて語の区切りとして扱う。
    SEPARATOR = /[[:space:]・]+/
    # 英数字の連続と、それ以外(カナ・漢字など)の連続を別トークンに分ける。
    TOKEN = /[a-z0-9]+|[^a-z0-9]+/

    module_function

    # カラム保存用: 正規化して区切り文字を除去した一本の文字列を返す。
    def normalize(text)
      fold(text).gsub(SEPARATOR, "")
    end

    # 検索クエリ用: 正規化した上でトークン列に分割する。空白・中点に加えて
    # 英数字とそれ以外の境界でも分割するので、「PL顆粒」は「pl」「顆粒」の
    # AND 検索となり「ＰＬ配合顆粒」にもヒットする。
    def tokenize(query)
      fold(query).split(SEPARATOR).flat_map { |chunk| chunk.scan(TOKEN) }
    end

    def fold(text)
      text.to_s.unicode_normalize(:nfkc).downcase.tr("ぁ-ゖ", "ァ-ヶ")
    end
  end
end
