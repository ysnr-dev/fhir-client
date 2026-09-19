module Imaging
  class InstancesController < BaseController
    # 1 インスタンスの上限。マルチフレーム(超音波・血管造影の動画)を見込んだ値。
    MAX_BYTES = 200 * 1024 * 1024
    CONTENT_TYPE = "application/dicom".freeze
    # タグから読んだ属性のうち、クライアントの申告をそのまま保存するもの。
    META_STRING_KEYS = %w[
      modality series_description body_part study_date study_time study_description
      accession_number institution_name source_patient_id source_patient_name
    ].freeze
    META_INTEGER_KEYS = %w[series_number instance_number number_of_frames].freeze

    # POST /imaging/instances (multipart: file, patient_id, meta)
    # 同じ SOP Instance UID を送り直しても 1 件のまま(再送・再取込が安全)。
    def create
      file = params[:file]
      return render_error("file is required") unless file.respond_to?(:read)
      return render json: { error: "file_too_large" }, status: :content_too_large if file.size > MAX_BYTES

      meta = parse_meta
      return render_error("meta is invalid") unless meta

      header = DicomHeader.read(file)
      return render_error("sop_instance_uid does not match the file") if header.sop_instance_uid != meta["sop_instance_uid"]

      existing = DicomInstance.find_by(sop_instance_uid: header.sop_instance_uid)
      return render_existing(existing) if existing

      instance = build_instance(meta, header, file)
      instance.save!
      render json: instance_json(instance, "created"), status: :created
    rescue DicomHeader::InvalidFile => e
      render_error(e.message)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    rescue ActiveRecord::RecordNotUnique
      render_existing(DicomInstance.find_by!(sop_instance_uid: header.sop_instance_uid))
    end

    # GET /imaging/instances/:sop_uid?patient=<id>
    # .dcm のバイト列をそのまま返す。内容は SOP Instance UID ごとに不変。
    def show
      instance = DicomInstance.find_by!(sop_instance_uid: params[:sop_uid], patient_id: patient_id!)
      blob = instance.file.blob
      raise ActiveRecord::RecordNotFound unless blob

      response.headers["Cache-Control"] = "private, max-age=31536000, immutable"
      return unless stale?(etag: blob.checksum, template: false)

      response.headers["Content-Type"] = CONTENT_TYPE
      response.headers["Content-Length"] = blob.byte_size.to_s
      response.headers["Content-Disposition"] = "inline"
      # 配列に溜めず、ストレージから来たチャンクをそのまま流す。
      self.response_body = Enumerator.new { |out| blob.download { |chunk| out << chunk } }
    end

    private

    def parse_meta
      meta = JSON.parse(params[:meta].to_s)
      meta.is_a?(Hash) ? meta : nil
    rescue JSON::ParserError
      nil
    end

    def build_instance(meta, header, file)
      instance = DicomInstance.new(
        patient_id: patient_id!,
        sop_instance_uid: header.sop_instance_uid,
        # SOP Class と転送構文はファイルから読んだ値を正とする。
        sop_class_uid: header.sop_class_uid,
        transfer_syntax_uid: header.transfer_syntax_uid,
        study_instance_uid: meta["study_instance_uid"],
        series_instance_uid: meta["series_instance_uid"],
        byte_size: file.size
      )
      META_STRING_KEYS.each { |key| instance[key] = meta[key].to_s.strip.presence }
      META_INTEGER_KEYS.each { |key| instance[key] = Integer(meta[key].to_s, 10, exception: false) }
      instance.file.attach(io: file, filename: "#{header.sop_instance_uid}.dcm",
                           content_type: CONTENT_TYPE, identify: false)
      instance
    end

    # 別の患者に取り込まれている UID は上書きも共有もしない。
    def render_existing(existing)
      if existing.patient_id == patient_id!
        render json: instance_json(existing, "exists")
      else
        render json: { error: "belongs_to_another_patient" }, status: :conflict
      end
    end

    def instance_json(instance, status)
      { status: status, sop_instance_uid: instance.sop_instance_uid, study_instance_uid: instance.study_instance_uid }
    end

    def render_error(message)
      render json: { error: message }, status: :unprocessable_content
    end
  end
end
