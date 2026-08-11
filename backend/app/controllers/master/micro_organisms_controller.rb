module Master
  # 細菌検査オーダーの目的菌(JANIS 感染症病原体コード)。編集UIは未実装のため、
  # 当面は検索と取込だけを持つ。
  class MicroOrganismsController < BaseController
    def index
      scope = Master::MicroOrganism.all
      scope = scope.frequent if params[:frequent] == "true"
      scope = scope.where(source: params[:source]) if params[:source].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:id))
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::MicroOrganismImporter.call(params[:file])
      render json: {
        imported: result.imported_count,
        skipped: result.skipped_count,
        sheet: result.sheet_name
      }
    end
  end
end
