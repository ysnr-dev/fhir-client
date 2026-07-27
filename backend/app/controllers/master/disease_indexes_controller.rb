module Master
  class DiseaseIndexesController < BaseController
    def index
      scope = Master::DiseaseIndex.all
      # カンマ区切りで複数指定可(検索結果の病名・修飾語をコードから一括で引くため)。
      scope = scope.where(target_code: params[:target_code].split(",")) if params[:target_code].present?
      if params[:disease_modifier_category].present?
        scope = scope.where(disease_modifier_category: params[:disease_modifier_category])
      end
      if params[:term].present?
        scope = flexible_name_match(scope, params[:term], %w[search_term])
      end

      render json: paginate(scope)
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::DiseaseIndexImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end
  end
end
