module Ssmix2
  module Hl7
    # HL7 ファイルの文字コード。SS-MIX2 は JIS(ISO-2022-JP)で格納する決まりで、受信側
    # (LabImport::TextDecoder)と揃えて CP50221 を使う(JIS X 0208 だけの ISO-2022-JP では
    # NEC/IBM 拡張の「髙」「①」や全角チルダが落ちる)。
    module Charset
      TARGET = "CP50221".freeze
      REPLACEMENT = "?".freeze
      # CP932 に無い字で、同じ意味の CP932 の字に寄せられるもの(波ダッシュ・双柱・マイナスなど)。
      NORMALIZE = {
        "〜" => "～", "‖" => "∥", "−" => "－", "—" => "―",
        "¢" => "￠", "£" => "￡", "¬" => "￢", "¦" => "￤"
      }.freeze
      # 半角カナは標準で認められないので全角に寄せる。全体に NFKC をかけると全角英数が ASCII に
      # 変わって氏名が崩れるため、半角カナの範囲だけに限る。
      HALFWIDTH_KANA = /[｡-ﾟ]+/

      Result = Struct.new(:bytes, :dropped, keyword_init: true)

      module_function

      def normalize(text)
        text.to_s.unicode_normalize(:nfc)
            .gsub(HALFWIDTH_KANA) { |kana| kana.unicode_normalize(:nfkc) }
            .gsub(/[#{NORMALIZE.keys.join}]/) { |char| NORMALIZE[char] }
      end

      # 変換できない字は「?」に置き換え、落とした字を dropped に返す(組み立て側が warning に残す)。
      def encode(text)
        normalized = normalize(text)
        dropped = normalized.each_char.reject { |char| encodable?(char) }.uniq
        bytes = normalized.encode(TARGET, undef: :replace, invalid: :replace, replace: REPLACEMENT)
        Result.new(bytes: bytes.b, dropped: dropped)
      end

      def encodable?(char)
        return true if char.ascii_only?

        char.encode(TARGET)
        true
      rescue EncodingError
        false
      end
    end
  end
end
