module Master
  class MedicineUsagesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::MedicineUsage.all
      scope = scope.where(usage_code: params[:usage_code]) if params[:usage_code].present?
      scope = scope.where("usage_name ILIKE ?", "%#{sanitize_like(params[:usage_name])}%") if params[:usage_name].present?

      render json: paginate(scope)
    end

    def show
      render json: @record
    end

    def create
      record = Master::MedicineUsage.new(record_params)
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_entity
      end
    end

    def update
      if @record.update(record_params)
        render json: @record
      else
        render json: { errors: @record.errors.full_messages }, status: :unprocessable_entity
      end
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_entity if params[:file].blank?

      result = MasterImport::MedicineUsageImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end

    private

    def set_record
      @record = Master::MedicineUsage.find(params[:id])
    end

    def record_params
      params.permit(Master::MedicineUsage.column_names - %w[id created_at updated_at])
    end
  end
end
