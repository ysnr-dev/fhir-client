module LabImport
  # ファイル 1 本を取り込んで台帳(LabResultImport と行)を作る。
  #
  # 上流 FHIR への登録はここでは行わない。判定(基準値・H/L・パニック値)・通知・
  # 報告区分の遷移がすべて frontend にあり、Ruby に複製すると二重保守になるため
  # (docs/lab-result-import-design.md §2)。
  class Importer
    PARSERS = { "hl7_v25" => Hl7Parser }.freeze
    INSERT_SLICE = 500

    Result = Struct.new(:import, :duplicate_ids, keyword_init: true)

    # @param imported_by [Hash] { login_id:, practitioner_id: }
    def initialize(file:, file_name: nil, format: "hl7_v25", encoding: "auto", imported_by: {})
      @file = file
      @file_name = file_name
      @format = format.presence || "hl7_v25"
      @encoding = encoding.presence || "auto"
      @imported_by = imported_by || {}
    end

    def call
      parser_class = PARSERS[@format]
      raise ImportError, "対応していない形式です(#{@format})" if parser_class.nil?

      decoded = TextDecoder.decode(read_file, requested: @encoding)
      parser = parser_class.new(decoded.text)
      message = parser.parse
      rows = RowBuilder.build(message)
      raise ImportError, "検査結果(OBX)が 1 件もありません" if rows.empty?

      ItemResolver.new.resolve_all(rows)
      import = save(message, decoded, rows, parser.skipped_count)
      Result.new(import: import, duplicate_ids: duplicate_ids(import))
    end

    private

    def read_file
      @file.respond_to?(:read) ? @file.read : @file.to_s
    end

    def save(message, decoded, rows, skipped_count)
      import = nil
      LabResultImport.transaction do
        import = LabResultImport.create!(
          source: message.source,
          format: @format,
          message_type: message.message_type,
          encoding: decoded.encoding,
          encoding_reason: decoded.reason,
          file_name: @file_name,
          message_control_id: message.control_id,
          message_datetime: message.sent_at,
          imported_by_login_id: @imported_by[:login_id],
          imported_by_practitioner_id: @imported_by[:practitioner_id],
          row_count: rows.size,
          skipped_count: skipped_count
        )
        now = Time.current
        rows.each_slice(INSERT_SLICE) do |slice|
          attributes = slice.map do |row|
            row.merge(lab_result_import_id: import.id, created_at: now, updated_at: now)
          end
          LabResultImportRow.insert_all!(attributes)
        end
      end
      import
    end

    # 同じメッセージ ID のバッチ。取込は止めず、画面で知らせるだけにする
    # (訂正版が同じ ID で来ることがあるため)。
    def duplicate_ids(import)
      return [] if import.message_control_id.blank?

      LabResultImport.where(message_control_id: import.message_control_id)
                     .where.not(id: import.id).order(:id).pluck(:id)
    end
  end
end
