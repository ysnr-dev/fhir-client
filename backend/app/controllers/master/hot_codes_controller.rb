module Master
  class HotCodesController < BaseController
    include Importable
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::HotCode.all
      scope = scope.where(hot_code: params[:hot_code]) if params[:hot_code].present?
      scope = scope.where(yakka_code: params[:yakka_code]) if params[:yakka_code].present?
      scope = scope.where("sales_name ILIKE ?", "%#{sanitize_like(params[:sales_name])}%") if params[:sales_name].present?

      render json: paginate(scope)
    end
  end
end
