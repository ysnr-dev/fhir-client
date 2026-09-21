module Master
  # 放射線治療の休止・中止理由マスタのメンテナンス。画面から手で登録する単純編集型
  # (docs/radiotherapy-order-design.md §3)。
  class RadiotherapyStopReasonsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::RadiotherapyStopReason.all
      # カンマ区切りで複数指定可(保存済みのオーダーから名称を引き直すため)。
      scope = scope.where(code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(enabled: true) if params[:enabled] == "true"
      # kind=terminate は「中止」に出す理由(both を含む)。
      scope = scope.where(kind: [params[:kind], "both"]) if params[:kind].present?
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    private

    def set_record
      # id ではなくコードでも引けるようにする。
      @record = Master::RadiotherapyStopReason.find_by(code: params[:id]) || Master::RadiotherapyStopReason.find(params[:id])
    end
  end
end
