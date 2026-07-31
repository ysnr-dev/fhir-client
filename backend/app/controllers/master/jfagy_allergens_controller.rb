module Master
  class JfagyAllergensController < BaseController
    def index
      scope = Master::JfagyAllergen.all
      scope = scope.where(jfagy_code: params[:jfagy_code]) if params[:jfagy_code].present?
      # 階層レベル(1〜6)での絞り込み。上位階層のみ表示する用途を想定。
      scope = scope.where(level: params[:level]) if params[:level].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end

      render json: paginate(scope)
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::JfagyAllergenImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end
  end
end
