module LabImport
  # 取込ファイルを UTF-8 の文字列にする。
  #
  # JAHIS 規約の既定は UNICODE UTF-8(MSH-18)だが、付録の例文は ISO IR87
  # (ISO-2022-JP)で、実運用では Shift_JIS のファイルも来る。Ruby は CP50221
  # (ISO-2022-JP + 半角カナ)を組み込みで変換できるので追加の gem は要らない。
  #
  # 判定の順序が要点で、ISO-2022-JP はすべて 7bit なので「UTF-8 として妥当」に
  # 見えてしまう。ESC シーケンスと MSH-18 の確認を UTF-8 妥当性より先に置く。
  module TextDecoder
    Result = Struct.new(:text, :encoding, :reason, keyword_init: true)

    UTF8_BOM = "\xEF\xBB\xBF".b.freeze
    # ISO-2022-JP の指示シーケンス(JIS X 0208 / ASCII / JIS ローマ字)。
    ESCAPE_PATTERN = /\e\$[@B]|\e\([BJI]/n
    REPLACEMENT = "�"
    # 置換文字がこの割合を超えたら、選んだ文字コードが違うとみなす。
    REPLACEMENT_RATIO_LIMIT = 0.01

    # 画面から明示指定できる名前 → Ruby の変換元エンコーディング。
    REQUESTED = {
      "utf-8" => "UTF-8",
      "utf8" => "UTF-8",
      "shift_jis" => "CP932",
      "cp932" => "CP932",
      "iso-2022-jp" => "CP50221",
      "cp50221" => "CP50221"
    }.freeze

    # 表示用の名前。
    DISPLAY = { "UTF-8" => "UTF-8", "CP932" => "CP932", "CP50221" => "ISO-2022-JP" }.freeze

    module_function

    # @param bytes [String] ファイルの中身(エンコーディングは問わない)
    # @param requested [String] "auto" または REQUESTED のキー
    def decode(bytes, requested: "auto")
      raw = bytes.to_s.dup.force_encoding(Encoding::ASCII_8BIT)
      raise ImportError, "ファイルが空です" if raw.empty?

      from, reason = detect(raw, requested)
      Result.new(text: convert(raw, from), encoding: DISPLAY.fetch(from, from), reason: reason)
    end

    def detect(raw, requested)
      key = requested.to_s.downcase
      return [REQUESTED.fetch(key), "manual"] if REQUESTED.key?(key)

      return ["UTF-8", "bom"] if raw.start_with?(UTF8_BOM)
      return ["CP50221", "escape"] if raw.match?(ESCAPE_PATTERN)

      charset = msh18(raw)
      if charset
        return ["UTF-8", "msh18"] if charset.match?(/UNICODE|UTF-?8/i)
        return ["CP50221", "msh18"] if charset.match?(/ISO[ -]?IR ?87|ISO[ -]?2022/i)
        return ["CP932", "msh18"] if charset.match?(/JIS ?X ?0201|SHIFT/i)
      end

      return ["UTF-8", "utf8_valid"] if raw.dup.force_encoding(Encoding::UTF_8).valid_encoding?

      ["CP932", "fallback"]
    end

    # 先頭の MSH セグメントの MSH-18(文字集合)を ASCII のまま覗く。
    # MSH だけはフィールドの添字が 1 つずれる(MSH-2 が parts[1] なので MSH-18 は parts[17])。
    def msh18(raw)
      head = raw[0, 1024].to_s
      return nil unless head.start_with?("MSH")

      line = head[/\A[^\r\n]*/].to_s
      separator = line[3]
      return nil if separator.nil? || separator.empty?

      line.split(separator, -1)[17].to_s.presence
    end

    def convert(raw, from)
      text =
        if from == "UTF-8"
          raw.dup.force_encoding(Encoding::UTF_8).scrub(REPLACEMENT)
        else
          raw.encode(Encoding::UTF_8, from, invalid: :replace, undef: :replace, replace: REPLACEMENT)
        end
      text = text.delete_prefix("﻿")
      guard_replacements(text)
      text
    end

    # 文字化けしたまま取り込むと保留行の名称が読めず原因も追えないので、
    # 置換が多いときは取込ごと止めて明示指定を促す。
    def guard_replacements(text)
      return if text.empty?

      replaced = text.count(REPLACEMENT)
      return if replaced.zero?
      return if replaced.to_f / text.length <= REPLACEMENT_RATIO_LIMIT

      raise ImportError, "文字コードを判定できません。取込画面で文字コードを指定してください"
    end
  end
end
