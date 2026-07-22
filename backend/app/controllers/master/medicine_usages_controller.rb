module Master
  class MedicineUsagesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::MedicineUsage.all
      scope = scope.where(usage_code: params[:usage_code]) if params[:usage_code].present?
      scope = flexible_name_match(scope, params[:usage_name], %w[search_name]) if params[:usage_name].present?
      scope = scope.where(basic_usage_category: params[:basic_usage_category]) if params[:basic_usage_category].present?
      scope = scope.where(detailed_usage_category: params[:detailed_usage_category]) if params[:detailed_usage_category].present?
      scope = scope.where(timing_category: params[:timing_category]) if params[:timing_category].present?
      # 1日の服用回数は usage_code の 4 桁目で表現される。
      scope = scope.where("SUBSTRING(usage_code FROM 4 FOR 1) = ?", params[:dose_count]) if params[:dose_count].present?

      render json: paginate(scope)
    end

    # 区分フィルタ用の選択肢（各区分の distinct な名称を区分コード順で返す）。
    def categories
      render json: {
        basic_usage_categories: distinct_category_names(:basic_usage_category_code, :basic_usage_category),
        detailed_usage_categories: distinct_category_names(:detailed_usage_category_code, :detailed_usage_category),
        timing_categories: distinct_category_names(:timing_category_code, :timing_category),
        dose_counts: distinct_dose_counts
      }
    end

    def show
      render json: @record
    end

    def create
      record = Master::MedicineUsage.new(record_params)
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

      result = MasterImport::MedicineUsageImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end

    private

    def distinct_category_names(code_column, name_column)
      Master::MedicineUsage
        .where.not(name_column => [nil, ""])
        .distinct
        .pluck(code_column, name_column)
        .sort_by { |code, _name| code.to_s }
        .map(&:last)
    end

    def distinct_dose_counts
      Master::MedicineUsage
        .distinct
        .pluck(Arel.sql("SUBSTRING(usage_code FROM 4 FOR 1)"))
        .compact
        .reject(&:blank?)
        .sort
    end

    def set_record
      @record = Master::MedicineUsage.find(params[:id])
    end

    def record_params
      params.permit(Master::MedicineUsage.column_names - %w[id created_at updated_at])
    end
  end
end
