# 口腔状態スナップショットの CSV ファイル(口腔診査情報標準コード仕様 Ver.1.02 の 6. 記録方式)。
#
# レコード(項目の配列)は frontend が組み立てる(診査の読み戻しとコード表を持つのが frontend のため。
# frontend/src/fhir/oralExamCsv.ts)。ここは仕様の記録方式どおりのバイト列にするだけ:
#  - 項目はカンマ区切り、引用符は使わない。レコードの末尾は CR LF、ファイルの最後は改行の後に EOF(0x1A)。
#  - 文字は Shift_JIS(Windows-31J)。JIS 規定外の文字は全角の疑問符「？」に置き換える(6.5)。
class OralExamSnapshotFile
  class InvalidRequest < StandardError; end

  ENCODING = "Windows-31J".freeze
  LINE_BREAK = "\r\n".freeze
  EOF_CODE = "\x1A".freeze
  REPLACEMENT = "？".freeze
  # 医療機関内等 ID(数字 6〜16 桁)-出力日時(14 桁)-スナップショット日時(14 桁).oes
  FILENAME_PATTERN = /\A\d{6,16}-\d{14}-\d{14}\.oes\z/
  RECORD_IDS = %w[VR ON PN NS TB TD TP TM TE TF TH KS KK SI SK HS HK IM DT].freeze
  MAX_RECORDS = 5_000
  MAX_FIELDS = 64

  attr_reader :filename

  def initialize(filename:, records:)
    @filename = filename.to_s
    @records = records
    validate!
  end

  def file
    body = @records.map { |fields| encode_line(fields) + LINE_BREAK.encode(ENCODING) }.join
    (body + EOF_CODE.encode(ENCODING)).force_encoding(Encoding::BINARY)
  end

  private

  def validate!
    raise InvalidRequest, "invalid_filename" unless FILENAME_PATTERN.match?(@filename)
    raise InvalidRequest, "invalid_records" unless @records.is_a?(Array) && @records.any? && @records.size <= MAX_RECORDS

    @records.each do |fields|
      valid = fields.is_a?(Array) && fields.size.between?(2, MAX_FIELDS) && fields.all? { |f| f.is_a?(String) }
      raise InvalidRequest, "invalid_records" unless valid && RECORD_IDS.include?(fields.first)
      # 区切りと改行は項目の中に入れられない(frontend で全角に寄せている)。
      raise InvalidRequest, "invalid_records" if fields.any? { |f| f.match?(/[,"\r\n]/) }
    end
    raise InvalidRequest, "invalid_records" unless @records.first.first == "VR" && @records.last.first == "DT"
  end

  def encode_line(fields)
    fields.join(",")
          .gsub(/[#{DpcForm1Export::WINDOWS_31J_EQUIVALENTS.keys.join}]/o, DpcForm1Export::WINDOWS_31J_EQUIVALENTS)
          .encode(ENCODING, invalid: :replace, undef: :replace, replace: REPLACEMENT.encode(ENCODING))
  end
end
