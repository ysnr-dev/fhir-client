module Master
  # 留置物種別マスタのメンテナンス。画面から手で登録する単純編集型(docs/line-drain-design.md §3)。
  class LineDrainTypesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LineDrainType.all
      scope = scope.where(code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      scope = scope.where(enabled: true) if params[:enabled] == "true"
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    private

    def set_record
      @record = Master::LineDrainType.find_by(code: params[:id]) || Master::LineDrainType.find(params[:id])
    end
  end
end
