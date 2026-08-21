module Master
  # 細菌検査オーダーの検査項目。seed の初期値を画面でメンテする施設マスタ。
  class MicroOrderItemsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::MicroOrderItem.all
      # active=true は今日オーダーできる項目(有効期間内)だけに絞る。
      scope = scope.active if params[:active] == "true"
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:id))
    end

    def update
      if @record.update(record_params.except("item_code"))
        render json: @record
      else
        render_validation_errors(@record)
      end
    end

    private

    def record_params
      params.permit(Master::MicroOrderItem.column_names - %w[id search_name created_at updated_at])
    end
  end
end
