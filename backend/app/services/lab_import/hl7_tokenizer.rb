module LabImport
  # HL7 v2 のテキストをセグメントに切り、フィールド・成分の取り出しを担う。
  #
  # 区切り文字は MSH-1(フィールド)と MSH-2(成分 ^ / 繰り返し ~ / エスケープ \ /
  # 副成分 &)で宣言される。1 ファイルに複数のメッセージが入ることがあるので、
  # MSH を見るたびに取り直す。
  module Hl7Tokenizer
    # MLLP の枠。ファイル転送型では付かないが、装置が吐いたものには付くことがある。
    MLLP_START = "\x0B"
    MLLP_END = "\x1C"
    # バッチファイルのヘッダ・トレーラ。中身のメッセージだけを読む。
    BATCH_SEGMENTS = %w[FHS BHS BTS FTS].freeze

    Delimiters = Struct.new(:field, :component, :repetition, :escape, :subcomponent,
                            keyword_init: true) do
      DEFAULT_ENCODING_CHARACTERS = "^~\\&"

      def self.from_msh(line)
        field = line[3]
        chars = line[4, 4].to_s
        chars = DEFAULT_ENCODING_CHARACTERS if chars.length < 4
        new(field: field, component: chars[0], repetition: chars[1],
            escape: chars[2], subcomponent: chars[3])
      end

      def self.default
        from_msh("MSH|^~\\&")
      end
    end

    # セグメント 1 本。フィールドの取り出しと、葉(最小単位)でのエスケープ復元を行う。
    #
    # 分割はフィールド → 繰り返し → 成分 → 副成分の順で、エスケープを戻すのは
    # 最後だけ。先に戻すと \S\ が成分区切りに化けてしまう。
    class Segment
      attr_reader :name, :delimiters

      def initialize(line, delimiters)
        @delimiters = delimiters
        @parts = line.split(delimiters.field, -1)
        @name = @parts[0].to_s
        @msh = @name == "MSH"
      end

      # SEG-n。MSH だけは MSH-1 が区切り文字そのもの、MSH-2 が parts[1] なので
      # 添字が 1 つずれる。
      def raw_field(index)
        return delimiters.field if @msh && index == 1

        @parts[@msh ? index - 1 : index].to_s
      end

      # 繰り返し(~)で分けた生の値。
      def raw_repetitions(index)
        raw_field(index).split(delimiters.repetition, -1)
      end

      def repetition_count(index)
        raw_repetitions(index).size
      end

      # 成分を指定しない場合は第 1 成分。HL7 では「値そのもの」と「第 1 成分」は
      # 同じものとして扱ってよい。
      def field(index, rep: 0)
        component(index, 1, rep: rep)
      end

      def component(index, component_index, rep: 0)
        raw = raw_repetitions(index)[rep]
        return "" if raw.nil?

        value = raw.split(delimiters.component, -1)[component_index - 1]
        unescape(value.to_s.split(delimiters.subcomponent, -1).first.to_s)
      end

      def subcomponent(index, component_index, subcomponent_index, rep: 0)
        raw = raw_repetitions(index)[rep]
        return "" if raw.nil?

        value = raw.split(delimiters.component, -1)[component_index - 1]
        unescape(value.to_s.split(delimiters.subcomponent, -1)[subcomponent_index - 1].to_s)
      end

      # フィールド全体を区切り文字ごとエスケープだけ戻して返す(NTE-3 の本文など)。
      def text(index, rep: 0)
        unescape(raw_repetitions(index)[rep].to_s)
      end

      def blank_field?(index)
        raw_field(index).empty?
      end

      # \F\ \S\ \T\ \R\ \E\ を元の文字に戻す。\.br\ は改行、\Xhh\ は 16 進。
      # 未知のエスケープは原文のまま残す(情報を落とさない)。
      def unescape(value)
        escape = delimiters.escape
        return value unless value.include?(escape)

        value.gsub(/#{Regexp.escape(escape)}([^#{Regexp.escape(escape)}]*)#{Regexp.escape(escape)}/) do
          code = Regexp.last_match(1)
          case code
          when "F" then delimiters.field
          when "S" then delimiters.component
          when "T" then delimiters.subcomponent
          when "R" then delimiters.repetition
          when "E" then escape
          when ".br" then "\n"
          when /\AX([0-9A-Fa-f]+)\z/
            [Regexp.last_match(1)].pack("H*").force_encoding(Encoding::UTF_8)
          else "#{escape}#{code}#{escape}"
          end
        end
      end
    end

    module_function

    # テキスト → Segment の配列。改行は CR / CRLF / LF のいずれでもよい。
    def segments(text)
      body = strip_mllp(text)
      lines = body.gsub(/\r\n|\n|\r/, "\r").split("\r").reject { |line| line.strip.empty? }
      lines = lines.drop_while { |line| BATCH_SEGMENTS.include?(line[0, 3]) }
      raise ImportError, "MSH セグメントがありません" unless lines.first.to_s.start_with?("MSH")

      delimiters = Delimiters.default
      lines.filter_map do |line|
        next if BATCH_SEGMENTS.include?(line[0, 3])

        delimiters = Delimiters.from_msh(line) if line.start_with?("MSH")
        Segment.new(line, delimiters)
      end
    end

    def strip_mllp(text)
      text.delete(MLLP_START).delete(MLLP_END)
    end
  end
end
