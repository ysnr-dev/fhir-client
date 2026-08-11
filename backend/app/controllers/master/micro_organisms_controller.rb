module Master
  # 細菌検査オーダーの目的菌(JANIS 感染症病原体コード)。配布ファイル由来の
  # 標準コード(source=official)は取込で洗い替えるため、画面から編集できるのは
  # 頻用菌の印(frequent)だけ。施設追加分(source=local)は自由に編集できる。
  class MicroOrganismsController < BaseController
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

    # 画面から作れるのは施設追加コードだけ。
    def create
      record = Master::MicroOrganism.new(record_params)
      record.source = Master::MicroOrganism::LOCAL
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      # 標準コードは頻用菌の印だけを切り替えられる。
      permitted = @record.official? ? record_params.slice("frequent") : record_params.except("source", "code")
      if @record.update(permitted)
        render json: @record
      else
        render json: { errors: @record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def destroy
      if @record.official?
        return render json: { errors: ["配布ファイル由来の標準コードは削除できません"] },
                      status: :unprocessable_content
      end

      @record.destroy!
      head :no_content
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

    private

    def set_record
      @record = Master::MicroOrganism.find(params[:id])
    end

    def record_params
      params.permit(Master::MicroOrganism.column_names - %w[id search_name created_at updated_at])
    end
  end
end
