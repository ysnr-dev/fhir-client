module Master
  # 看護観察マスタ(MEDIS 看護実践用語標準マスター 看護観察編)。読み取り専用。
  class NursingObservationsController < BaseController
    include Importable

    def index
      scope = Master::NursingObservation.all
      scope = scope.active unless params[:active] == "false"
      scope = scope.where(manage_no: params[:manage_no].split(",")) if params[:manage_no].present?
      # 検索大分類(1〜8)。該当列が "0" 以外の行が属する。
      if params[:category].present?
        n = params[:category].to_i
        if (1..8).cover?(n)
          column = :"search_category_#{n}"
          scope = scope.where.not(column => [nil, "", "0"])
        end
      end
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end
      render json: paginate(scope.order(:manage_no), max_per: 500)
    end
  end
end
