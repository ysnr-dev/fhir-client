module Master
  # 口腔診査情報のコード表。固定の標準コード表なので読み取りだけ(画面からは直さない)。
  class OralExamCodesController < BaseController
    def index
      scope = Master::OralExamCode.order(Arel.sql("display_order NULLS LAST"))
      scope = scope.where(record: params[:record]) if params[:record].present?
      scope = scope.where(item: params[:item]) if params[:item].present?
      render json: paginate(scope, max_per: 1000)
    end
  end
end
