module Master
  # 用量と患者条件の規則。オーダー画面が全件を読んで手元で照合するのでページングしない。
  # docs/drug-check-master-design.md
  class DrugDoseRulesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::DrugDoseRule.all
      scope = flexible_name_match(scope, params[:q], %w[name code message]) if params[:q].present?
      render json: scope.order(:code, :id)
    end
  end
end
