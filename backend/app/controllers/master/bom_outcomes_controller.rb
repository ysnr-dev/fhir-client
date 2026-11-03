module Master
  # BOM(Basic Outcome Master®)のアウトカム。パス定義の編集でアウトカムのコードを選ぶのに使う。
  # 登録・編集は無く、配布ファイルの取込(import)と検索(index)だけ。
  class BomOutcomesController < BaseController
    include Importable

    def index
      scope = Master::BomOutcome.all
      scope = scope.where(outcome_code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(category_code: params[:category_code]) if params[:category_code].present?
      scope = scope.where(subcategory_code: params[:subcategory_code]) if params[:subcategory_code].present?
      scope = flexible_name_match(scope, params[:name], %w[search_name]) if params[:name].present?
      render json: paginate(scope.order(:display_order, :id))
    end

    # アウトカムに属する観察項目(BOM の OAT の組)。観察項目マスターにある行はその分類・MEDIS を添え、
    # 無いコードは組の行の名称だけで返す。パス定義でアウトカムを選んだときにまとめて入れる。
    def assessments
      pairs = Master::BomPair.where(outcome_code: params[:id]).order(:display_order, :id)
      masters = Master::BomAssessment.where(assessment_code: pairs.map(&:assessment_code)).index_by(&:assessment_code)
      items = pairs.map do |pair|
        master = masters[pair.assessment_code]
        master ? master.as_json : { "assessment_code" => pair.assessment_code, "name" => pair.assessment_name }
      end
      render json: { items: items }
    end
  end
end
