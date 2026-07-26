module Master
  class LabItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LabItem.all
      scope = scope.where(jlac11_code: params[:jlac11_code]) if params[:jlac11_code].present?
      scope = scope.where(jlac10_code: params[:jlac10_code]) if params[:jlac10_code].present?
      scope = scope.where(category_name: params[:category_name]) if params[:category_name].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_abbreviation])
      end

      render json: paginate(scope)
    end

    def show
      render json: @record
    end

    def create
      record = Master::LabItem.new(record_params)
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

      result = MasterImport::LabItemImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end

    private

    def set_record
      @record = Master::LabItem.find(params[:id])
    end

    def record_params
      params.permit(Master::LabItem.column_names - %w[id created_at updated_at])
    end
  end
end
