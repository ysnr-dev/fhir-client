module Master
  # データ抽出の実行の記録(定点観測の推移)。画面が保存した条件を直さずに実行したときに残し、
  # 履歴として新しい順に返す。記録の書き換えはしない(消すのは条件ごと)。
  class ExtractQueryRunsController < BaseController
    HISTORY_LIMIT = 200

    def index
      query = ExtractQuery.find(params[:extract_query_id])
      runs = query.extract_query_runs.order(ran_at: :desc).limit(HISTORY_LIMIT)
      render json: { items: runs.map { |run| detail(run) } }
    end

    def create
      query = ExtractQuery.find(params[:extract_query_id])
      run = query.extract_query_runs.new(
        ran_at: Time.current,
        patient_count: params[:patient_count],
        leaf_counts: params[:leaf_counts].respond_to?(:to_unsafe_h) ? params[:leaf_counts].to_unsafe_h : {},
        ran_by_id: current_user&.practitioner_fhir_id || params[:ran_by_id].presence,
        ran_by_name: params[:ran_by_name].presence
      )
      if run.save
        render json: detail(run), status: :created
      else
        render_validation_errors(run)
      end
    end

    private

    def detail(run)
      run.as_json(only: %i[id extract_query_id ran_at patient_count leaf_counts ran_by_id ran_by_name])
    end
  end
end
