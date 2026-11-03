module Master
  # カルテの重要日(docs/features/karte.md)。患者と診療日につき 1 つで、利用者の間で共有する。
  # チャートのピン留めと同じく /master の基底(ログイン認証・CSRF・エラー整形)に乗せる。
  class KarteImportantDaysController < BaseController
    before_action :require_patient_id!

    # 患者の重要日を全部返す(件数は少ないので絞り込み・ページングは無い)。
    def index
      days = KarteImportantDay.where(patient_id: patient_id).order(:day)
      render json: days.map { |record| detail(record) }
    end

    # 設定。その日にすでにあれば置き換える(患者と日につき 1 つ)。
    def update
      record = KarteImportantDay.find_or_initialize_by(patient_id: patient_id, day: params[:day])
      record.assign_attributes(
        severity: params[:severity],
        comment: params[:comment].to_s.strip.presence,
        set_by_id: current_user&.practitioner_fhir_id,
        set_by_name: params[:set_by_name].presence,
      )
      if record.save
        render json: detail(record)
      else
        render_validation_errors(record)
      end
    end

    def destroy
      KarteImportantDay.where(patient_id: patient_id, day: params[:day]).delete_all
      head :no_content
    end

    private

    def patient_id
      params[:patient_id].presence
    end

    def require_patient_id!
      render json: { error: "patient_id is required" }, status: :bad_request if patient_id.blank?
    end

    def detail(record)
      {
        patient_id: record.patient_id,
        day: record.day.iso8601,
        severity: record.severity,
        comment: record.comment,
        set_by_id: record.set_by_id,
        set_by_name: record.set_by_name,
        updated_at: record.updated_at,
      }
    end
  end
end
