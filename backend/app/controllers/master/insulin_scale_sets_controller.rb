module Master
  # インスリンのスライディングスケールのセット。スケールの入力の選択肢として全件をまとめて引く。
  class InsulinScaleSetsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::InsulinScaleSet.order(Arel.sql("display_order NULLS LAST"))
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      render json: paginate(scope, max_per: 500)
    end

    private

    def record_params
      params.permit(:name, :kind, :display_order, rows: Master::InsulinScaleSet::ROW_KEYS)
    end
  end
end
