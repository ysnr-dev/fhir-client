module Master
  # 処方監査の介入種別マスタのメンテナンス。画面から手で登録する単純編集型(docs/rx-verification-design.md §4.1)。
  class PharmacistInterventionTypesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::PharmacistInterventionType.all
      scope = scope.where(code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(enabled: true) if params[:enabled] == "true"
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    private

    def set_record
      @record = Master::PharmacistInterventionType.find_by(code: params[:id]) ||
                Master::PharmacistInterventionType.find(params[:id])
    end
  end
end
