module Master
  # 警告の確認理由マスタのメンテナンス。画面から手で登録する単純編集型(docs/advisory-design.md §3.1)。
  class AdvisoryOverrideReasonsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::AdvisoryOverrideReason.all
      scope = scope.where(code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(enabled: true) if params[:enabled] == "true"
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    private

    def set_record
      @record = Master::AdvisoryOverrideReason.find_by(code: params[:id]) || Master::AdvisoryOverrideReason.find(params[:id])
    end
  end
end
