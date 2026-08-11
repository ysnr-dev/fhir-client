module Master
  # JJ1017(画像検査オーダーコード)の32桁コードの組み立て・分解と、部品コードの
  # 桁数・使用可能文字・施設拡張範囲の定義。
  #
  # 指針 Ver3.4 表5.1 のコード構造:
  #   JJ1017-16M(1〜16桁): 手技コード部 + 部位コード部 + 姿勢・撮影方向 + 拡張(汎用)
  #   JJ1017-16S(17〜32桁): 撮影条件等の詳細指示部 + 超音波画像モード + 委員会予約
  #
  # 部品コード表(master_rad_jj1017_codes)を持つ要素だけを ELEMENTS に定義し、
  # 拡張(汎用)・超音波画像モード・委員会予約は「表を持たない固定領域」として
  # 埋め草(0)で扱う。
  module Jj1017Code
    CODE_LENGTH = 32
    FILLER = "0".freeze

    # JJ1017 で使える文字。数字と、I・O を除いた英大文字(指針 5.4.1)。
    CHARACTER_CLASS = "0-9A-HJ-NP-Z".freeze
    LETTER_CLASS = "A-HJ-NP-Z".freeze

    # 部品コード表を持つ要素。offset は32桁文字列の0始まり位置。
    # extension は施設拡張として登録してよいコードの形(指針 5.4.2 / 5.5.3 / 5.6.2 / 5.7.2)。
    # extension が nil の要素は施設拡張を認めない。
    # reserved_prefixes は JJ1017 側が標準コードに割り当て済み・予約済みの先頭文字で、
    # 施設拡張には使わせない(Z=予約、J=核医学領域、P=放射線治療領域、S=その他領域)。
    ELEMENTS = {
      "modality" => {
        label: "種別(モダリティ)", offset: 0, length: 1, table: "別表1A(本文 表5.2)",
        extension: /\A[P-Y]\z/, extension_label: "P〜Y", reserved_prefixes: %w[Z]
      },
      "procedure_major" => {
        label: "手技(大分類)", offset: 1, length: 2, table: "別表1B",
        extension: /\A[#{LETTER_CLASS}][#{CHARACTER_CLASS}]\z/, extension_label: "A0以降(英大文字始まり)",
        reserved_prefixes: %w[J P Z]
      },
      "procedure_minor" => {
        label: "手技(小分類)", offset: 3, length: 2, table: "別表1C",
        extension: /\A[#{LETTER_CLASS}][#{CHARACTER_CLASS}]\z/, extension_label: "A0以降(英大文字始まり)",
        reserved_prefixes: %w[J P Z]
      },
      # 手技(拡張)だけは施設拡張が「01以降」= 数字始まり。J/P/S 始まりが標準割当。
      "procedure_extension" => {
        label: "手技(拡張)", offset: 5, length: 2, table: "別表1D",
        extension: /\A[0-9][#{CHARACTER_CLASS}]\z/, extension_label: "01以降(数字始まり)",
        reserved_prefixes: %w[J P S Z]
      },
      "body_part" => {
        label: "部位(小部位)", offset: 7, length: 3, table: "別表3",
        extension: /\A[#{LETTER_CLASS}][#{CHARACTER_CLASS}]{2}\z/, extension_label: "A00以降(英大文字始まり)",
        reserved_prefixes: %w[Z]
      },
      "laterality" => {
        label: "左右等", offset: 10, length: 1, table: "別表4(本文 表5.5)",
        extension: nil, extension_label: nil, reserved_prefixes: []
      },
      "body_position" => {
        label: "姿勢体位", offset: 11, length: 1, table: "別表5A",
        extension: /\A[A-HJ-N]\z/, extension_label: "A〜N(P〜Yは拡張不可)", reserved_prefixes: %w[Z]
      },
      "direction" => {
        label: "入射・撮影方向・撮影法", offset: 12, length: 2, table: "別表5B",
        extension: /\A[#{LETTER_CLASS}][#{CHARACTER_CLASS}]\z/, extension_label: "A0以降(英大文字始まり)",
        reserved_prefixes: %w[Z]
      },
      "detail_position" => {
        label: "詳細体位", offset: 16, length: 2, table: "別表6A",
        extension: /\A[#{LETTER_CLASS}][#{CHARACTER_CLASS}]\z/, extension_label: "A0以降(英大文字始まり)",
        reserved_prefixes: %w[Z]
      },
      "special_instruction" => {
        label: "特殊指示", offset: 18, length: 2, table: "別表6B",
        extension: /\A[#{LETTER_CLASS}][#{CHARACTER_CLASS}]\z/, extension_label: "A0以降(英大文字始まり)",
        reserved_prefixes: %w[Z]
      },
      "nuclide" => {
        label: "核種(線種)", offset: 20, length: 2, table: "別表6C",
        extension: /\A[#{LETTER_CLASS}][#{CHARACTER_CLASS}]\z/, extension_label: "A0以降(英大文字始まり)",
        reserved_prefixes: %w[Z]
      }
    }.freeze

    ELEMENT_NAMES = ELEMENTS.keys.freeze

    # 15〜16桁目。JJ1017-16M 側の共通拡張領域(表を持たないので項目マスタが直接持つ)。
    GENERIC_EXTENSION_OFFSET = 14
    GENERIC_EXTENSION_LENGTH = 2

    module_function

    def element?(name)
      ELEMENTS.key?(name.to_s)
    end

    def length_of(element)
      ELEMENTS.fetch(element.to_s)[:length]
    end

    def extension_allowed?(element)
      !ELEMENTS.fetch(element.to_s)[:extension].nil?
    end

    # 要素コードの値として形が正しいか(標準コード・施設拡張コードに共通の最低条件)。
    def valid_code_format?(element, code)
      /\A[#{CHARACTER_CLASS}]{#{length_of(element)}}\z/.match?(code.to_s)
    end

    # 施設拡張コードとして登録してよい値か。
    def valid_extension_code?(element, code)
      pattern = ELEMENTS.fetch(element.to_s)[:extension]
      return false if pattern.nil?

      pattern.match?(code.to_s)
    end

    def reserved_prefix?(element, code)
      ELEMENTS.fetch(element.to_s)[:reserved_prefixes].include?(code.to_s[0])
    end

    # 要素コードの Hash から32桁コードを組み立てる。未指定の要素と、部品表を
    # 持たない領域(超音波画像モード・委員会予約)は 0 で埋める。
    # generic_extension は15〜16桁目(拡張(汎用))。
    def compose(elements, generic_extension: nil)
      buffer = FILLER * CODE_LENGTH

      ELEMENTS.each do |name, spec|
        value = elements[name] || elements[name.to_sym]
        next if value.blank?

        buffer[spec[:offset], spec[:length]] = value.to_s.rjust(spec[:length], FILLER)
      end

      if generic_extension.present?
        buffer[GENERIC_EXTENSION_OFFSET, GENERIC_EXTENSION_LENGTH] =
          generic_extension.to_s.rjust(GENERIC_EXTENSION_LENGTH, FILLER)
      end

      buffer
    end

    # 32桁コードを要素コードの Hash に分解する。0 埋めの(=指定なしの)要素は
    # 値を持たせない。generic_extension は "generic_extension" キーで返す。
    def decompose(code)
      raise ArgumentError, "JJ1017コードは#{CODE_LENGTH}桁です" unless code.to_s.length == CODE_LENGTH

      result = ELEMENTS.each_with_object({}) do |(name, spec), acc|
        value = code[spec[:offset], spec[:length]]
        acc[name] = value unless value == FILLER * spec[:length]
      end

      generic = code[GENERIC_EXTENSION_OFFSET, GENERIC_EXTENSION_LENGTH]
      result["generic_extension"] = generic unless generic == FILLER * GENERIC_EXTENSION_LENGTH
      result
    end
  end
end
