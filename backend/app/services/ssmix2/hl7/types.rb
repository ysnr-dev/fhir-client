module Ssmix2
  module Hl7
    # HL7 v2.5 のデータ型をフィールドの文字列に組む。葉の文字列はここでエスケープするので、
    # 組み立て側は生の値を渡す。並びは SS-MIX2 標準化ストレージ仕様書の各フィールドの [SS-MIX2] 欄に従う。
    module Types
      FIELD = "|".freeze
      COMPONENT = "^".freeze
      REPEAT = "~".freeze
      ESCAPE = "\\".freeze
      SUBCOMPONENT = "&".freeze
      ENCODING_CHARACTERS = "^~\\&".freeze

      module_function

      # HL7 のエスケープ。改行は \.br\ に写す。
      def text(value)
        value.to_s.gsub(ESCAPE, "\\E\\").gsub(FIELD, "\\F\\").gsub(COMPONENT, "\\S\\")
             .gsub(REPEAT, "\\R\\").gsub(SUBCOMPONENT, "\\T\\").gsub(/\r\n|\r|\n/, "\\.br\\")
      end

      # 成分を ^ でつなぐ。末尾の空成分は落とす。
      def components(*parts) = join(parts, COMPONENT)

      def subcomponents(*parts) = join(parts, SUBCOMPONENT)

      # 繰返しを ~ でつなぐ。空の繰返しは落とす。
      def repeats(*items) = items.flatten.map(&:to_s).reject(&:empty?).join(REPEAT)

      # CWE。<code>^<text>^<system>。alt は別のコード体系での併記(第 4〜6 成分)。
      def cwe(code, text_value = nil, system = nil, alt: nil)
        parts = [text(code), text(text_value), text(system)]
        parts += [text(alt[0]), text(alt[1]), text(alt[2])] if alt
        components(*parts)
      end

      # CWE を副成分(&)で書く形(TQ1-3 の繰返しパターンなど)。
      def cwe_sub(code, text_value = nil, system = nil, alt: nil)
        parts = [text(code), text(text_value), text(system)]
        parts += [text(alt[0]), text(alt[1]), text(alt[2])] if alt
        subcomponents(*parts)
      end

      # CX。<id>^^^^<type>。
      def cx(id, type: "PI") = components(text(id), "", "", "", type)

      # XPN。<姓>^<名>^^^^^<名前タイプ L>^<表記 I/P>。
      def xpn(family, given, representation)
        components(text(family), text(given), "", "", "", "", "L", representation)
      end

      # XCN。<ID>^<姓>^<名>^^^^^^^<名前タイプ L>^^^^^<表記 I/P>。
      def xcn(id, family, given, representation)
        components(text(id), text(family), text(given), "", "", "", "", "", "", "L", "", "", "", "", representation)
      end

      # XAD。^^^^<郵便番号>^<国>^<住所タイプ>^<住所の文字列>。
      def xad(postal_code, address_text, type: "H", country: "JPN")
        components("", "", "", "", text(postal_code), country, type, text(address_text))
      end

      # XTN。^<用途 PRN/WPN>^PH^^^^^^^^^<番号>。
      def xtn(number, use: "PRN")
        components("", use, "PH", "", "", "", "", "", "", "", "", text(number))
      end

      # PL(入院)。<病棟>^<病室>^<ベッド>^^^N。
      def pl_inpatient(ward, room, bed) = components(text(ward), text(room), text(bed), "", "", "N")

      # PL(外来)。<診療科>^^^^^C。
      def pl_outpatient(department_code) = components(text(department_code), "", "", "", "", "C")

      # EI(オーダ番号)。
      def ei(value) = text(value)

      def join(parts, separator)
        values = parts.map { |part| part.nil? ? "" : part.to_s }
        values.pop while values.any? && values.last.empty?
        values.join(separator)
      end
    end
  end
end
