module Master
  # 施設が定義する警告の規則のマスタ(docs/advisory-design.md §3.6)。コードは警告の key と
  # 台帳の集計に使うので、作成後は変えさせない。
  class AdvisoryRulesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::AdvisoryRule.all
      scope = scope.where(enabled: true) if params[:enabled] == "true"
      scope = scope.where("contexts @> ?", [params[:context].to_s].to_json) if params[:context].present?
      scope = scope.where.not(maintenance: nil) if params[:maintenance] == "true"
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    def update
      if @record.update(record_params.except("code"))
        render json: @record
      else
        render_validation_errors(@record)
      end
    end

    private

    def set_record
      @record = Master::AdvisoryRule.find_by(code: params[:id]) || Master::AdvisoryRule.find(params[:id])
    end

    def record_params
      attrs = params.permit(:code, :name, :enabled, :display_order, :severity, :expression, :message, :detail, :basis, contexts: [])
      # 定期項目は null で外せるようにする(permit のネストは nil を通さない)。
      attrs[:maintenance] = maintenance_param if params.key?(:maintenance)
      attrs
    end

    def maintenance_param
      value = params[:maintenance]
      return nil if value.blank?

      value.permit(*Master::AdvisoryRule::MAINTENANCE_KEYS).to_h
    end
  end
end
