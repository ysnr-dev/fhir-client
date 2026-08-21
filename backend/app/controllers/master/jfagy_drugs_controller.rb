module Master
  class JfagyDrugsController < BaseController
    def index
      scope = Master::JfagyDrug.all
      scope = scope.where(jfagy_code: params[:jfagy_code]) if params[:jfagy_code].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end

      render json: paginate(scope)
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::JfagyDrugImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end
  end
end
