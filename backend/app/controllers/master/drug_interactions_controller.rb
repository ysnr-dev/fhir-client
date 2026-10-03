module Master
  # 薬剤の相互作用。オーダー画面が全件を読んで手元で照合するのでページングしない。
  # docs/drug-check-master-design.md
  class DrugInteractionsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::DrugInteraction.all
      if params[:q].present?
        scope = flexible_name_match(scope, params[:q], %w[name_a name_b code_a code_b note])
      end
      render json: scope.order(:code_a, :code_b)
    end
  end
end
