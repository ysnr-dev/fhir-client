module Master
  # 病名と薬の禁忌・注意。オーダー画面が全件を読んで手元で照合するのでページングしない。
  # docs/drug-check-master-design.md
  class DrugDiseaseRulesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::DrugDiseaseRule.all
      if params[:q].present?
        scope = flexible_name_match(scope, params[:q], %w[name code disease_name disease_code note])
      end
      render json: scope.order(:code, :disease_code)
    end
  end
end
