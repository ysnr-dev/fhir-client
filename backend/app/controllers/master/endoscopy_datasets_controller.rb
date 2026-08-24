module Master
  # 内視鏡の実施入力用データセット。画面から手動で登録し、明細(手技料・薬剤・
  # 器材)は endoscopy_dataset_details で編集する。詳細では明細に参照先マスタの名称を
  # 添えて返すので、画面はコードだけを持てばよい。
  class EndoscopyDatasetsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::EndoscopyDataset.all
      # カンマ区切りで複数指定可(オーダー項目に紐付くデータセットをまとめて引くため)。
      if params[:dataset_code].present?
        scope = scope.where(dataset_code: params[:dataset_code].split(","))
      end
      # active=true は今日使えるデータセット(有効期間内)だけに絞る。
      scope = scope.active_on if params[:active] == "true"
      scope = flexible_name_match(scope, params[:name], %w[search_name search_kana]) if params[:name].present?

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:dataset_code))
    end

    # 明細を名称付きで同梱する。詳細画面が1リクエストで開けるようにする。
    def show
      render json: @record.as_json.merge(
        details: Master::EndoscopyDatasetDetail.with_names
                                            .where(dataset_code: @record.dataset_code)
                                            .in_display_order.as_json
      )
    end

    def create
      record = Master::EndoscopyDataset.new(record_params)
      record.dataset_code = next_dataset_code if record.dataset_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    # 外部キーを張っていないので、明細とオーダー項目からの参照も併せて片付ける。
    def destroy
      code = @record.dataset_code
      Master::EndoscopyDataset.transaction do
        Master::EndoscopyDatasetDetail.where(dataset_code: code).delete_all
        Master::EndoscopyItem.where(dataset_code: code).update_all(dataset_code: nil)
        @record.destroy!
      end
      head :no_content
    end

    private

    # 数字だけのデータセットコードの最大値の次。手入力の英字混じりコードは無視する
    # (内視鏡オーダー項目マスタと同じ採番)。
    def next_dataset_code
      max = Master::EndoscopyDataset.where("dataset_code ~ '^[0-9]+$'")
                                 .maximum(Arel.sql("dataset_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなくデータセットコードでも引けるようにする。
      @record = Master::EndoscopyDataset.find_by(dataset_code: params[:id]) ||
                Master::EndoscopyDataset.find(params[:id])
    end
  end
end
