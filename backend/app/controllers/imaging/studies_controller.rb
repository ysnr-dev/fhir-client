module Imaging
  class StudiesController < BaseController
    # GET /imaging/studies?patient=<id>
    # スタディごとの保存済み枚数。取込フォームが「取込済」の判定に使う。
    def index
      counts = DicomInstance.where(patient_id: patient_id!).group(:study_instance_uid).count
      render json: counts.map { |uid, count| { study_instance_uid: uid, instance_count: count } }
    end

    # GET /imaging/studies/:study_uid/instances?patient=<id>
    # 保存済みインスタンスの一覧(表示順)。ImagingStudy に無い属性(フレーム数・転送構文)を
    # ビューアが読む。
    def instances
      rows = study_instances.in_display_order
      render json: rows.map { |row|
        {
          sop_instance_uid: row.sop_instance_uid,
          series_instance_uid: row.series_instance_uid,
          sop_class_uid: row.sop_class_uid,
          transfer_syntax_uid: row.transfer_syntax_uid,
          instance_number: row.instance_number,
          number_of_frames: row.number_of_frames,
          byte_size: row.byte_size
        }
      }
    end

    # POST /imaging/studies/:study_uid/commit (patient_id)
    # 保存済みの行から ImagingStudy を組み立てて上流に置く。何度呼んでも行の現状に揃う。
    def commit
      rows = study_instances.in_display_order.to_a
      raise ActiveRecord::RecordNotFound if rows.empty?

      study = ImagingStudyPublisher.new(patient_id!, params[:study_uid]).publish(rows)
      render json: { id: study["id"], instance_count: rows.size }
    end

    # DELETE /imaging/studies/:study_uid?patient=<id>
    # 上流の ImagingStudy を先に消す。そこで失敗したら実体は残す
    # (ImagingStudy はあるのに画像が無い、という状態を作らない)。
    def destroy
      rows = study_instances.to_a
      raise ActiveRecord::RecordNotFound if rows.empty?

      ImagingStudyPublisher.new(patient_id!, params[:study_uid]).unpublish
      rows.each do |row|
        row.file.purge
        row.destroy!
      end
      head :no_content
    end

    private

    def study_instances
      DicomInstance.of_study(patient_id!, params[:study_uid])
    end
  end
end
