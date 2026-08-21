module Master
  # 細菌検査オーダーの検体種別(JANIS 材料コード)。配布ファイル由来の
  # 標準コード(source=official)は取込で洗い替えるためこの画面では読むだけ。
  # 書けるのは施設追加分(source=local)だけ。
  class MicroSpecimenTypesController < BaseController
    include OfficialLocalRecords
    include Importable

    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::MicroSpecimenType.all
      scope = scope.where(category: params[:category]) if params[:category].present?
      scope = scope.where(source: params[:source]) if params[:source].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:id))
    end

    private

    def import_result_json(result)
      { imported: result.imported_count, skipped: result.skipped_count }
    end
  end
end
