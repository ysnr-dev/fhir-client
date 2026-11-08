module Master
  # 病理検査オーダーの臓器・検査材料(JAHIS テーブル LPATHO003)。規約付録由来の
  # 標準コード(source=official)は seed で投入するため画面から編集できるのは
  # 頻用臓器の印(frequent)だけ。施設追加分(source=local)は自由に編集できる。
  class PathoOrgansController < BaseController
    include OfficialLocalRecords
    include FrequentOfficialRecords

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

    private

    def official_source_label
      "規約付録"
    end
  end
end
