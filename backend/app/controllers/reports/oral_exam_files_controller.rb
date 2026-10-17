module Reports
  # 口腔状態スナップショットの CSV(.oes)。レコードは画面が組み立てて送り、ここで Shift_JIS のファイルにする。
  class OralExamFilesController < BaseController
    rescue_from OralExamSnapshotFile::InvalidRequest do |error|
      render json: { error: error.message }, status: :unprocessable_content
    end

    # POST /reports/oral_exam_file  { filename, records: [[項目, ...], ...] }
    def create
      file = OralExamSnapshotFile.new(filename: params[:filename], records: records_param)
      send_data file.file, filename: file.filename, type: "text/csv", disposition: "attachment"
    end

    private

    def records_param
      raw = params[:records]
      return nil unless raw.is_a?(Array)

      raw.map { |fields| fields.is_a?(Array) ? fields.map { |f| f.is_a?(String) ? f : f.to_s } : fields }
    end
  end
end
