module Master
  # 細菌検査結果の薬剤感受性で使う抗菌薬(JANIS 抗菌薬コード)。配布ファイル由来の
  # 標準コード(source=official)は取込で洗い替えるため、画面から編集できるのは
  # 頻用薬の印(frequent)だけ。施設追加分(source=local)は自由に編集できる。
  class MicroAntimicrobialsController < BaseController
    include OfficialLocalRecords
    include Importable

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

    def update
      # 標準コードは頻用薬の印だけを切り替えられる。
      permitted = @record.official? ? record_params.slice("frequent") : record_params.except("source", "code")
      if @record.update(permitted)
        render json: @record
      else
        render_validation_errors(@record)
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
