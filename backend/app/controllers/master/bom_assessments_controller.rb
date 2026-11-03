module Master
  # BOM(Basic Outcome Master®)の観察項目。パス定義の編集で観察項目のコードを選ぶのに使う。
  # 登録・編集は無く、配布ファイルの取込(import)と検索(index)だけ。
  class BomAssessmentsController < BaseController
    include Importable

    def index
      scope = Master::BomAssessment.all
      scope = scope.where(assessment_code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(category_code: params[:category_code]) if params[:category_code].present?
      scope = flexible_name_match(scope, params[:name], %w[search_name]) if params[:name].present?
      render json: paginate(scope.order(:display_order, :id))
    end
  end
end
