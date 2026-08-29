module Master
  # 看護観察編の観察結果テーブル。列挙型の選択肢をグループコードで引く。読み取り専用。
  class NursingObservationResultsController < BaseController
    include Importable

    def index
      scope = Master::NursingObservationResult.all
      if params[:result_group_code].present?
        scope = scope.where(result_group_code: params[:result_group_code].split(","))
      end
      render json: paginate(scope.order(:result_group_code, :result_code), max_per: 500)
    end
  end
end
