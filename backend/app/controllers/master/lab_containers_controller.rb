module Master
  # 採取管マスタのメンテナンス。配布ファイルが無い画面編集専用マスタなので
  # 取込は持たない(初期値は db:seed で入る)。
  class LabContainersController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LabContainer.all
      # カンマ区切りで複数指定可(検体・オーダー項目の一覧が採取管名を一括解決するため)。
      if params[:container_code].present?
        scope = scope.where(container_code: params[:container_code].split(","))
      end
      scope = scope.where("name LIKE ?", "%#{sanitize_like(params[:name])}%") if params[:name].present?

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end

    def show
      render json: @record
    end

    def create
      record = Master::LabContainer.new(record_params)
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

    private

    def set_record
      @record = Master::LabContainer.find(params[:id])
    end

    def record_params
      params.permit(Master::LabContainer.column_names - %w[id created_at updated_at])
    end
  end
end
