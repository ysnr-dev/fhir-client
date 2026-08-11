module Master
  # 細菌検査オーダーの検体種別(JANIS 材料コード)。編集UIは未実装のため、
  # 当面は検索と取込だけを持つ。
  class MicroSpecimenTypesController < BaseController
    def index
      scope = Master::MicroSpecimenType.all
      scope = scope.where(category: params[:category]) if params[:category].present?
      scope = scope.where(source: params[:source]) if params[:source].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:id))
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::MicroSpecimenTypeImporter.call(params[:file])
      render json: { imported: result.imported_count, skipped: result.skipped_count }
    end
  end
end
