module Master
  # 放射線治療装置マスタのメンテナンス。画面から手で登録する単純編集型
  # (docs/radiotherapy-order-design.md §3)。
  class RadiotherapyDevicesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::RadiotherapyDevice.all
      # カンマ区切りで複数指定可(保存済みのオーダーから名称を引き直すため)。
      scope = scope.where(code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(enabled: true) if params[:enabled] == "true"

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    private

    def set_record
      # id ではなくコードでも引けるようにする。
      @record = Master::RadiotherapyDevice.find_by(code: params[:id]) || Master::RadiotherapyDevice.find(params[:id])
    end

    def record_params
      params.permit(*(model_class.column_names - %w[id created_at updated_at modality_codes]), modality_codes: [])
    end
  end
end
