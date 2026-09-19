# DICOM ファイル(Part 10)の先頭だけを読む。保存前に「DICOM であること」と
# 「申告された SOP Instance UID が実体と一致すること」を確かめるためのもので、
# データセット本体(転送構文ごとに読み方が変わる)は読まない。
#
# 読むのは File Meta Information(group 0002)だけ。ここは転送構文によらず常に
# Explicit VR Little Endian で書かれる。
class DicomHeader
  class InvalidFile < StandardError; end

  PREAMBLE_LENGTH = 128
  MAGIC = "DICM".b.freeze
  # File Meta Information は数百バイト。余裕を見てもこれだけ読めば足りる。
  READ_LENGTH = 16 * 1024
  # 値長を 4 バイトで持つ VR(2 バイトの予約領域が先に入る)。
  LONG_VRS = %w[OB OD OF OL OV OW SQ UC UN UR UT].freeze

  TAG_SOP_CLASS = [0x0002, 0x0002].freeze
  TAG_SOP_INSTANCE = [0x0002, 0x0003].freeze
  TAG_TRANSFER_SYNTAX = [0x0002, 0x0010].freeze

  attr_reader :sop_class_uid, :sop_instance_uid, :transfer_syntax_uid

  # io は read / rewind に応える IO(アップロードの tempfile)。
  def self.read(io)
    io.rewind
    bytes = io.read(READ_LENGTH).to_s.b
    io.rewind
    new(bytes)
  end

  def initialize(bytes)
    raise InvalidFile, "not a DICOM file" unless bytes.byteslice(PREAMBLE_LENGTH, 4) == MAGIC

    parse_meta(bytes, PREAMBLE_LENGTH + 4)
    raise InvalidFile, "SOP Instance UID is missing" if sop_instance_uid.blank?
    raise InvalidFile, "SOP Class UID is missing" if sop_class_uid.blank?
  end

  private

  def parse_meta(bytes, offset)
    while offset + 8 <= bytes.bytesize
      group, element = bytes.byteslice(offset, 4).unpack("v2")
      break unless group == 0x0002

      vr = bytes.byteslice(offset + 4, 2)
      if LONG_VRS.include?(vr)
        length = bytes.byteslice(offset + 8, 4).to_s.unpack1("V")
        value_offset = offset + 12
      else
        length = bytes.byteslice(offset + 6, 2).unpack1("v")
        value_offset = offset + 8
      end
      # 不定長(0xFFFFFFFF)は File Meta Information には現れない。
      break if length.nil? || length == 0xFFFFFFFF

      assign([group, element], bytes.byteslice(value_offset, length).to_s)
      offset = value_offset + length
    end
  end

  def assign(tag, raw)
    # UI は偶数長に揃えるため末尾に NUL が詰められる。
    value = raw.delete("\0").strip
    case tag
    when TAG_SOP_CLASS then @sop_class_uid = value
    when TAG_SOP_INSTANCE then @sop_instance_uid = value
    when TAG_TRANSFER_SYNTAX then @transfer_syntax_uid = value
    end
  end
end
