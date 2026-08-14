module Master
  # 撮影項目マスタと実施入力用データセットの紐付け。撮影項目の詳細画面から編集し、
  # 実施入力からは「この撮影項目に何が紐付いているか」を引くのに使う。
  class RadItemDatasetsController < BaseController
    before_action :set_record, only: %i[destroy]

    def index
      scope = Master::RadItemDataset.all
      # どちらもカンマ区切りで複数指定可(オーダーに載っている撮影項目の紐付けを
      # 実施入力がまとめて引くため)。
      scope = scope.where(item_code: params[:item_code].split(",")) if params[:item_code].present?
      scope = scope.where(dataset_code: params[:dataset_code].split(",")) if params[:dataset_code].present?

      # データセット名を添える(撮影項目の詳細画面が紐付けを並べて見せるため)。
      scope = scope
        .joins("LEFT JOIN master_rad_datasets " \
               "ON master_rad_datasets.dataset_code = master_rad_item_datasets.dataset_code")
        .select(
          "master_rad_item_datasets.*",
          "master_rad_datasets.name AS dataset_name",
        )

      render json: paginate(scope.order(Arel.sql("master_rad_item_datasets.display_order NULLS LAST")))
    end

    def create
      record = Master::RadItemDataset.new(record_params)
      # 追加順に並べる(明示されていれば従う)。
      record.display_order ||= next_display_order(record.item_code)
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    private

    def next_display_order(item_code)
      (Master::RadItemDataset.where(item_code: item_code).maximum(:display_order) || 0) + 1
    end

    def set_record
      @record = Master::RadItemDataset.find(params[:id])
    end

    def record_params
      params.permit(Master::RadItemDataset.column_names - %w[id created_at updated_at])
    end
  end
end
