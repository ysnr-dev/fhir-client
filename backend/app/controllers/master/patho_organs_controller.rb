module Master
  # 病理検査オーダーの臓器・検査材料(JAHIS テーブル LPATHO003)。規約付録由来の
  # 標準コード(source=official)は seed で投入するため画面から編集できるのは
  # 頻用臓器の印(frequent)だけ。施設追加分(source=local)は自由に編集できる。
  class PathoOrgansController < BaseController
    include OfficialLocalRecords

    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::PathoOrgan.all
      scope = scope.frequent if params[:frequent] == "true"
      scope = scope.where(source: params[:source]) if params[:source].present?
      if params[:name].present?
        # search_name には名称と ICD-10 の両方が正規化して入っている(PathoOrgan を参照)。
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:id))
    end

    def update
      # 標準コードは頻用臓器の印だけを切り替えられる。
      permitted = @record.official? ? record_params.slice("frequent") : record_params.except("source", "code")
      if @record.update(permitted)
        render json: @record
      else
        render_validation_errors(@record)
      end
    end

    def destroy
      if @record.official?
        return render json: { errors: ["規約付録由来の標準コードは削除できません"] },
                      status: :unprocessable_content
      end

      @record.destroy!
      head :no_content
    end
  end
end
