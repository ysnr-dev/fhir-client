module Master
  class DiseasesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::Disease.all
      scope = scope.where(management_number: params[:management_number]) if params[:management_number].present?
      scope = scope.where(exchange_code: params[:exchange_code]) if params[:exchange_code].present?
      scope = scope.where(icd10_2013: params[:icd10_2013]) if params[:icd10_2013].present?
      # 削除区分(変更区分=1)のレコードを除外して現行病名だけを返す。
      # IS DISTINCT FROM で change_category が NULL の手動作成レコードも残す。
      scope = scope.where("change_category IS DISTINCT FROM '1'") if params[:exclude_deleted].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end

      render json: paginate(scope)
    end

    def show
      render json: @record
    end

    def create
      record = Master::Disease.new(record_params)
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

      result = MasterImport::DiseaseImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end

    private

    def set_record
      @record = Master::Disease.find(params[:id])
    end

    def record_params
      params.permit(Master::Disease.column_names - %w[id created_at updated_at])
    end
  end
end
