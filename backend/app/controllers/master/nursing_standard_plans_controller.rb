module Master
  # 標準看護計画。看護問題の立案では看護診断のコードで引き、写す。
  class NursingStandardPlansController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::NursingStandardPlan.all
      # diagnosis_code=none は看護診断に結びつかない計画。
      if params[:diagnosis_code] == "none"
        scope = scope.where(diagnosis_code: nil)
      elsif params[:diagnosis_code].present?
        scope = scope.where(diagnosis_code: params[:diagnosis_code].to_s.split(",").map(&:strip))
      end
      scope = scope.where(active: ActiveModel::Type::Boolean.new.cast(params[:active])) if params[:active].present?
      scope = flexible_name_match(scope, params[:q], %w[search_name search_kana]) if params[:q].present?
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:code), max_per: 500)
    end

    private

    def record_params
      params.permit(:code, :name, :name_kana, :diagnosis_code, :note, :active, :display_order,
                    goals: Master::NursingStandardPlan::GOAL_KEYS,
                    activities: Master::NursingStandardPlan::ACTIVITY_KEYS)
    end
  end
end
