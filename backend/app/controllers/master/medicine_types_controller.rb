module Master
  class MedicineTypesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::MedicineType.all
      scope = scope.where(code: params[:code]) if params[:code].present?
      scope = flexible_name_match(scope, params[:name], %w[search_name]) if params[:name].present?

      render json: paginate(scope)
    end

    # 選択UI（プルダウン）用に全薬効分類を薬効分類番号順で返す。件数が数百件と
    # 少なくページングも不要なため、ページングせず配列で返す。
    def options
      render json: Master::MedicineType.order(:code).select(:id, :code, :name)
    end
  end
end
