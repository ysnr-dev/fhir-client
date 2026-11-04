module Ssmix2
  module Hl7
    # セグメントを積んで電文にする。フィールドの値は Types で組んだ文字列を受ける
    # (エスケープは Types が済ませている)。セグメント終端は CR、電文の終端にも CR を置き、
    # ファイルには <FS><CR> を付けない(標準化ストレージの格納形態)。
    class Builder
      SEGMENT_TERMINATOR = "\r".freeze
      VERSION = "2.5".freeze
      PROCESSING_ID = "P".freeze
      CHARACTER_SET = "~ISO IR87".freeze
      ALTERNATE_CHARACTER_SET_HANDLING = "ISO 2022-1994".freeze
      PROFILE = "SS-MIX2_1.20_j^SS-MIX2^1.2.392.200250.2.1.100.1.2.120^ISO".freeze

      attr_reader :segments

      def initialize
        @segments = []
      end

      # MSH。message_type は "ADT^A08^ADT_A01" の形。control_id はメッセージを一意にする番号。
      def msh(sending_application:, sending_facility:, message_type:, control_id:, at: Stamp.now)
        fields = [
          Types.text(sending_application), Types.text(sending_facility), "GW", "",
          Stamp.format(at, precision: :millisecond), "", message_type, Types.text(control_id),
          PROCESSING_ID, VERSION, "", "", "", "", "", CHARACTER_SET, "", ALTERNATE_CHARACTER_SET_HANDLING, PROFILE
        ]
        @segments << (["MSH", Types::ENCODING_CHARACTERS] + fields).join(Types::FIELD)
        self
      end

      # 任意のセグメント。fields は 1 番目のフィールドから順に並べ、末尾の空フィールドは落とす。
      def add(name, *fields)
        values = fields.flatten.map { |field| field.nil? ? "" : field.to_s }
        values.pop while values.any? && values.last.empty?
        @segments << ([name] + values).join(Types::FIELD)
        self
      end

      def to_s
        @segments.join(SEGMENT_TERMINATOR) + SEGMENT_TERMINATOR
      end
    end
  end
end
