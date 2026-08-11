module Master
  # 細菌検査オーダーの採取方法。seed の初期値を画面でメンテする施設マスタ。
  class MicroCollectionMethodsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      render json: paginate(
        Master::MicroCollectionMethod.order(Arel.sql("display_order NULLS LAST")).order(:id)
      )
    end

    def create
      record = Master::MicroCollectionMethod.new(record_params)
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      if @record.update(record_params.except("code"))
        render json: @record
      else
        render json: { errors: @record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    private

    def set_record
      @record = Master::MicroCollectionMethod.find(params[:id])
    end

    def record_params
      params.permit(Master::MicroCollectionMethod.column_names - %w[id created_at updated_at])
    end
  end
end
