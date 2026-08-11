module Master
  # 細菌検査結果の薬剤感受性で使う抗菌薬(JANIS 抗菌薬コード)。配布ファイル由来の
  # 標準コード(source=official)は取込で洗い替えるため、画面から編集できるのは
  # 頻用薬の印(frequent)だけ。施設追加分(source=local)は自由に編集できる。
  class MicroAntimicrobialsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::MicroAntimicrobial.all
      scope = scope.frequent if params[:frequent] == "true"
      scope = scope.where(source: params[:source]) if params[:source].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_abbreviation])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:id))
    end

    # 画面から作れるのは施設追加コードだけ。
    def create
      record = Master::MicroAntimicrobial.new(record_params)
      record.source = Master::MicroAntimicrobial::LOCAL
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      # 標準コードは頻用薬の印だけを切り替えられる。
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

      result = MasterImport::MicroAntimicrobialImporter.call(params[:file])
      render json: {
        imported: result.imported_count,
        skipped: result.skipped_count,
        sheet: result.sheet_name
      }
    end

    private

    def set_record
      @record = Master::MicroAntimicrobial.find(params[:id])
    end

    def record_params
      params.permit(Master::MicroAntimicrobial.column_names - %w[id search_name search_abbreviation created_at updated_at])
    end
  end
end
