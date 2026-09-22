module Master
  # 照射モダリティマスタのメンテナンス。画面から手で登録する単純編集型
  # (docs/radiotherapy-order-design.md §3)。
  class RadiotherapyModalitiesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::RadiotherapyModality.all
      # カンマ区切りで複数指定可(保存済みのオーダーから名称を引き直すため)。
      scope = scope.where(code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(enabled: true) if params[:enabled] == "true"

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    private

    def set_record
      # id ではなくコードでも引けるようにする。
      @record = Master::RadiotherapyModality.find_by(code: params[:id]) || Master::RadiotherapyModality.find(params[:id])
    end
  end
end
