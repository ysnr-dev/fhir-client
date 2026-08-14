module Master
  # 放射線検査の実施入力用データセット。画面から手動で登録し、明細(手技料・造影剤・
  # 器材)は rad_dataset_details で編集する。詳細では明細に参照先マスタの名称を
  # 添えて返すので、画面はコードだけを持てばよい。
  class RadDatasetsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::RadDataset.all
      # カンマ区切りで複数指定可(撮影項目に紐付くデータセットをまとめて引くため)。
      scope = scope.where(dataset_code: params[:dataset_code].split(",")) if params[:dataset_code].present?
      # active=true は今日使えるデータセット(有効期間内)だけに絞る。
      scope = scope.active_on if params[:active] == "true"
      scope = flexible_name_match(scope, params[:name], %w[search_name search_kana]) if params[:name].present?

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:dataset_code))
    end

    # 明細を名称付きで同梱する。詳細画面が1リクエストで開けるようにする。
    def show
      render json: @record.as_json.merge(
        details: Master::RadDatasetDetail.with_names
                                         .where(dataset_code: @record.dataset_code)
                                         .in_display_order.as_json
      )
    end

    def create
      record = Master::RadDataset.new(record_params)
      record.dataset_code = next_dataset_code if record.dataset_code.blank?
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

    # 外部キーを張っていないので、明細と撮影項目からの参照も併せて片付ける。
    def destroy
      code = @record.dataset_code
      Master::RadDataset.transaction do
        Master::RadDatasetDetail.where(dataset_code: code).delete_all
        Master::RadItem.where(dataset_code: code).update_all(dataset_code: nil)
        @record.destroy!
      end
      head :no_content
    end

    private

    # 数字だけのデータセットコードの最大値の次。手入力の英字混じりコードは無視する
    # (放射線オーダー項目マスタと同じ採番)。
    def next_dataset_code
      max = Master::RadDataset.where("dataset_code ~ '^[0-9]+$'")
                              .maximum(Arel.sql("dataset_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなくデータセットコードでも引けるようにする。
      @record = Master::RadDataset.find_by(dataset_code: params[:id]) || Master::RadDataset.find(params[:id])
    end

    def record_params
      params.permit(Master::RadDataset.column_names - %w[id created_at updated_at])
    end
  end
end
