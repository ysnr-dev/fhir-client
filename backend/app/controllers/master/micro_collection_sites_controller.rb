module Master
  # 細菌検査オーダーの採取部位。seed の初期値を画面でメンテする施設マスタ。
  class MicroCollectionSitesController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      render json: paginate(
        Master::MicroCollectionSite.order(Arel.sql("display_order NULLS LAST")).order(:id)
      )
    end

    def update
      if @record.update(record_params.except("code"))
        render json: @record
      else
        render_validation_errors(@record)
      end
    end
  end
end
