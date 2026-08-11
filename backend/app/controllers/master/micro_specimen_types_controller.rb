module Master
  # 細菌検査オーダーの検体種別(JANIS 材料コード)。配布ファイル由来の
  # 標準コード(source=official)は取込で洗い替えるためこの画面では読むだけ。
  # 書けるのは施設追加分(source=local)だけ。
  class MicroSpecimenTypesController < BaseController
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

    # 画面から作れるのは施設追加コードだけ。
    def create
      record = Master::MicroSpecimenType.new(record_params)
      record.source = Master::MicroSpecimenType::LOCAL
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      return render_official_readonly if @record.official?

      if @record.update(record_params.except("source", "code"))
        render json: @record
      else
        render json: { errors: @record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def destroy
      return render_official_readonly if @record.official?

      @record.destroy!
      head :no_content
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::MicroSpecimenTypeImporter.call(params[:file])
      render json: { imported: result.imported_count, skipped: result.skipped_count }
    end

    private

    def render_official_readonly
      render json: { errors: ["配布ファイル由来の標準コードは編集できません"] },
             status: :unprocessable_content
    end

    def set_record
      @record = Master::MicroSpecimenType.find(params[:id])
    end

    def record_params
      params.permit(Master::MicroSpecimenType.column_names - %w[id search_name created_at updated_at])
    end
  end
end
