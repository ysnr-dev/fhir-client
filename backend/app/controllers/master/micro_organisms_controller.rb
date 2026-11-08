module Master
  # 細菌検査オーダーの目的菌(JANIS 感染症病原体コード)。配布ファイル由来の
  # 標準コード(source=official)は取込で洗い替えるため、画面から編集できるのは
  # 頻用菌の印(frequent)だけ。施設追加分(source=local)は自由に編集できる。
  class MicroOrganismsController < BaseController
    include OfficialLocalRecords
    include FrequentOfficialRecords
    include Importable

    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::MicroOrganism.all
      scope = scope.frequent if params[:frequent] == "true"
      scope = scope.where(source: params[:source]) if params[:source].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:id))
    end

    private

    def import_result_json(result)
      {
        imported: result.imported_count,
        skipped: result.skipped_count,
        sheet: result.sheet_name
      }
    end
  end
end
