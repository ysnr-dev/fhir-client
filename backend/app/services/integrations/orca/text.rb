module Integrations
  module Orca
    # 日レセへ送る文字列の正規化。
    #
    # 日レセは患者氏名・病名に全角チェックを持っていて、半角英数や半角カナが混ざると
    # 「全角チェックでエラーとなる文字が病名に存在します」「名称の全角変換エラーです」で
    # 弾かれる。カルテ側は半角入力を許しているので、送る手前で寄せる。
    module Text
      module_function

      # 氏名や病名として送る全角文字列。
      def widen(value)
        return "" if value.blank?

        # NFKC で半角カナを全角へ寄せる(濁点も 1 文字に合成される)。ただし NFKC は
        # 全角英数も半角に潰すので、そのあとで英数記号と空白を全角へ送り直す。
        # この順序でないと「ﾀﾞ」が直らないか、「Ａ」が半角のまま残るかのどちらかになる。
        normalized = value.to_s.unicode_normalize(:nfkc)
        normalized.tr("!-~", "！-～").tr(" ", "　").strip
      end

      # 氏名の「姓　名」。ORCA は姓名を 1 項目(WholeName)で持ち、全角空白で区切る。
      def whole_name(family, given)
        [widen(family), widen(given)].reject(&:empty?).join("　")
      end
    end
  end
end
