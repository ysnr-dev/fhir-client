module Master
  class HotCodesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::HotCode.all
      scope = scope.where(hot_code: params[:hot_code]) if params[:hot_code].present?
      scope = scope.where(yakka_code: params[:yakka_code]) if params[:yakka_code].present?
      scope = scope.where("sales_name ILIKE ?", "%#{sanitize_like(params[:sales_name])}%") if params[:sales_name].present?

      render json: paginate(scope)
    end

    def show
      render json: @record
    end

    def create
      record = Master::HotCode.new(record_params)
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      if @record.update(record_params)
        render json: @record
      else
        render json: { errors: @record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::HotCodeImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end

    private

    def set_record
      @record = Master::HotCode.find(params[:id])
    end

    def record_params
      params.permit(Master::HotCode.column_names - %w[id created_at updated_at])
    end
  end
end
