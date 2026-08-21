module Master
  class JfagyDrugsController < BaseController
    include Importable
    def index
      scope = Master::JfagyDrug.all
      scope = scope.where(jfagy_code: params[:jfagy_code]) if params[:jfagy_code].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end

      render json: paginate(scope)
    end
  end
end
