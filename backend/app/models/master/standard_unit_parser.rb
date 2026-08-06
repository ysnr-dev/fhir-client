module Master
  # HOTコードマスタの規格単位(master_hot_codes.standard_unit)を構造化する。
  #
  # 規格単位は「３０ｍｇ２０ｍＬ１管」「２％１ｇ」のような自由記述だが、
  #
  #   <規格部(力価量 / 濃度% / 容量)>?  <薬価算定単位量><薬価算定単位>  （<付属品>）?
  #
  # という文法で例外なく解釈できる。末尾の <数量><単位> が必ず薬価算定単位
  # (= master_medicines.unit_name に対応)で、それを剥がした残りが規格部。
  module StandardUnitParser
    # 力価(成分量)の単位。長いものから試すため出現順は問わない。
    STRENGTH_UNITS = %w[mg ug ng g mEq MBq KIU 万単位 国際単位 単位 力価].freeze
    VOLUME_UNITS = %w[mL L].freeze
    # 薬価算定単位のうち「量そのもの」であるもの。生薬・軟膏・内用液など、
    # 入力量がそのまま製剤量になる(換算不要)品目がこれに当たる。
    QUANTITY_UNITS = %w[g mL L mg ug MBq mEq 万単位 国際単位 単位].freeze
    # 数え上げの薬価算定単位。
    COUNT_UNITS = %w[
      錠 カプセル 包 瓶 管 袋 筒 キット 枚 個 組 回分 セット シート シリンジ
      丸 缶 バイアル アンプル 本 患者当り カセット 台 巻 束 双 対 冊 箱
      mLV バッグ デバイス
    ].freeze
    PACK_UNITS = (COUNT_UNITS + QUANTITY_UNITS).freeze

    # master_medicines.unit_name と規格単位で表記が異なるもの。
    # 例) 薬価は「１００単位１ｍＬバイアル」だがレセ電の単位名は「ｍＬＶ」。
    UNIT_ALIASES = { "mLV" => "バイアル" }.freeze

    NUMBER = /\d+(?:\.\d+)?/
    STRENGTH_RE = Regexp.union(STRENGTH_UNITS.sort_by { |u| -u.size })
    VOLUME_RE = Regexp.union(VOLUME_UNITS.sort_by { |u| -u.size })
    PACK_RE = Regexp.union(PACK_UNITS.sort_by { |u| -u.size })

    TAIL = /(#{NUMBER})?\s*(#{PACK_RE})\s*\z/
    TOKEN = /\A\s*(#{NUMBER})\s*(%|#{STRENGTH_RE}|#{VOLUME_RE})/
    PAREN = /[（(]([^）)]*)[）)]/

    Spec = Struct.new(
      :pack_quantity, :pack_unit, :strength_value, :strength_unit,
      :concentration_pct, :volume_ml,
      keyword_init: true
    )

    module_function

    # 解釈できなければ nil を返す。
    def parse(standard_unit)
      parenthesized = []
      body = normalize(standard_unit).gsub(PAREN) { parenthesized << ::Regexp.last_match(1); "" }.strip
      return nil if body.empty?

      tail = TAIL.match(body)
      return nil if tail.nil?

      spec = Spec.new(pack_quantity: (tail[1] || "1").to_f, pack_unit: tail[2])
      scan_spec_part(body[0...tail.begin(0)], spec)
      # 括弧書きは「（溶解液付）」のような付属品が大半だが、「（１．５ｇ）１瓶」のように
      # 規格そのものが括弧に入ることもある。本体から力価も濃度も取れないときだけ拾う。
      if spec.strength_value.nil? && spec.concentration_pct.nil?
        parenthesized.each { |inner| scan_spec_part(inner, spec) }
      end
      spec
    end

    # 医薬品名から規格を読む。規格単位と違って名前には薬価算定単位が含まれないので、
    # 医薬品マスタの単位名を薬価算定単位として与える(「アテノロール２５ｍｇ錠」+ 錠)。
    # 規格単位を引けない一般名収載品や、規格単位に力価が無い貼付剤で使う。
    def parse_name(name, pack_unit)
      spec = Spec.new(pack_quantity: 1.0, pack_unit: canonical_unit(pack_unit))
      scan_spec_part(normalize(name), spec)
      spec
    end

    # 薬価算定単位の表記ゆれを吸収した比較用の値。
    def canonical_unit(unit)
      normalized = normalize(unit)
      UNIT_ALIASES.fetch(normalized, normalized)
    end

    def quantity_unit?(unit)
      QUANTITY_UNITS.include?(unit)
    end

    # 全角英数・全角記号を NFKC で畳み込み、桁区切りとマイクロ記号を揃える。
    # ㎡ は NFKC で "m2" になり末尾の薬価算定単位量に数字が食い込むため、
    # 語彙外の面積単位として先に空白へ落とす(貼付剤の「１０ｃ㎡１枚」など)。
    def normalize(text)
      text.to_s.gsub("㎡", " ").unicode_normalize(:nfkc).gsub(/[,，]/, "").gsub(/[μµ]/, "u").strip
    end

    # 規格部を <数値><単位> のトークン列として読む。成分名などの未知トークンは
    # 1文字ずつ読み飛ばす。各種類とも最初に出た値を採用する(配合剤は先頭成分)。
    def scan_spec_part(text, spec)
      rest = text.to_s
      until rest.empty?
        match = TOKEN.match(rest)
        if match.nil?
          rest = rest[1..] || ""
          next
        end

        value = match[1].to_f
        unit = match[2]
        rest = rest[match.end(0)..] || ""

        if unit == "%"
          spec.concentration_pct ||= value
        elsif VOLUME_UNITS.include?(unit)
          spec.volume_ml ||= (unit == "L" ? value * 1000 : value)
        else
          next if spec.strength_value

          spec.strength_value = value
          spec.strength_unit = unit
        end
      end
    end
  end
end
